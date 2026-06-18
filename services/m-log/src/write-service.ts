import type { AuditLog, FullLog, TimelineLog } from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { auditLogs, fullLogs, timelineLogs } from '../../../packages/db/src/schema.ts'
import { createLogger } from '../../../packages/telemetry/src/index.ts'
import type { createLogEventPublisher } from './event-publisher.ts'
import type { createOpenSearchAdapter } from './opensearch.ts'

const logger = createLogger('m-log')

type TimelineWriteRequest = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteRequest = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteRequest = Omit<AuditLog, 'id' | 'timestamp'>

export function warnProjectionFallback(
  kind: 'timeline' | 'full' | 'audit',
  entryId: string,
  error: unknown
): void {
  logger.warn(
    { kind, entryId, error: error instanceof Error ? error.message : String(error) },
    'opensearch_index_failed'
  )
}

export function createLogWriteService(
  db: MeristemDb,
  opensearch: ReturnType<typeof createOpenSearchAdapter>,
  opensearchAvailable: boolean,
  publisher: ReturnType<typeof createLogEventPublisher>
) {
  return {
    async writeTimeline(request: TimelineWriteRequest): Promise<TimelineLog> {
      const entry: TimelineLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...request
      }
      await db.insert(timelineLogs).values({
        id: entry.id,
        timestamp: new Date(entry.timestamp),
        summary: entry.summary,
        subject: entry.subject,
        correlationId: entry.correlationId
      })

      if (opensearchAvailable) {
        void opensearch.indexTimelineLog(entry).catch(error => {
          warnProjectionFallback('timeline', entry.id, error)
        })
      }

      return entry
    },
    async writeFull(request: FullWriteRequest): Promise<FullLog> {
      const entry: FullLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...request
      }
      await db.insert(fullLogs).values({
        id: entry.id,
        timestamp: new Date(entry.timestamp),
        level: entry.level,
        source: entry.source,
        message: entry.message,
        correlationId: entry.correlationId,
        traceId: entry.traceId,
        payload: entry.payload
      })

      if (opensearchAvailable) {
        void opensearch.indexFullLog(entry).catch(error => {
          warnProjectionFallback('full', entry.id, error)
        })
      }

      return entry
    },
    async writeAudit(request: AuditWriteRequest): Promise<AuditLog> {
      const entry: AuditLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...request
      }
      await db.insert(auditLogs).values({
        id: entry.id,
        timestamp: new Date(entry.timestamp),
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        decisionId: entry.decisionId,
        result: entry.result,
        correlationId: entry.correlationId,
        traceId: entry.traceId,
        payload: entry.payload
      })

      if (opensearchAvailable) {
        void opensearch.indexAuditLog(entry).catch(error => {
          warnProjectionFallback('audit', entry.id, error)
        })
      }

      await publisher.publishAuditCreated({
        auditId: entry.id,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        ...(entry.decisionId ? { decisionId: entry.decisionId } : {}),
        ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
        ...(entry.traceId ? { traceId: entry.traceId } : {})
      })

      return entry
    }
  }
}
