import type {
  AuditLog,
  FullLog,
  MDeployDigestFromSchema,
  MDeployEvidenceTypeFromSchema,
  MDeployStorageRefV01FromSchema,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  auditLogs,
  deploymentEvidence,
  fullLogs,
  timelineLogs
} from '../../../packages/db/src/schema.ts'
import { createLogger, recordCounter } from '../../../packages/telemetry/src/index.ts'
import type { createLogEventPublisher } from './event-publisher.ts'
import type { createOpenSearchAdapter } from './opensearch.ts'
import type { OpenSearchReadModel } from './opensearch-read-model.ts'

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

type ProjectionKind = 'timeline' | 'full' | 'audit'

/**
 * 投影在权威写入后异步执行；失败只更新读模型降级状态，绝不能回滚或等待 PostgreSQL 日志事实。
 */
export async function projectAfterAuthoritativeWrite(input: {
  kind: ProjectionKind
  entryId: string
  project(): Promise<boolean>
  onFailure(error: unknown): void
}): Promise<void> {
  try {
    const projected = await input.project()
    if (!projected) {
      input.onFailure(new Error(`OpenSearch ${input.kind} projection rejected document`))
    }
  } catch (error) {
    input.onFailure(error)
  }
}

export function createLogWriteService(
  db: MeristemDb,
  opensearch: ReturnType<typeof createOpenSearchAdapter>,
  readModel: Pick<OpenSearchReadModel, 'isAvailable' | 'markUnavailable'>,
  publisher: ReturnType<typeof createLogEventPublisher>
) {
  function scheduleProjection(
    kind: ProjectionKind,
    entryId: string,
    project: () => Promise<boolean>
  ): void {
    void projectAfterAuthoritativeWrite({
      kind,
      entryId,
      project,
      onFailure(error) {
        warnProjectionFallback(kind, entryId, error)
        readModel.markUnavailable()
      }
    })
  }

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

      if (readModel.isAvailable()) {
        scheduleProjection('timeline', entry.id, () => opensearch.indexTimelineLog(entry))
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

      if (readModel.isAvailable()) {
        scheduleProjection('full', entry.id, () => opensearch.indexFullLog(entry))
      }

      return entry
    },
    async writeAudit(request: AuditWriteRequest): Promise<AuditLog> {
      const entry: AuditLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...request
      }
      try {
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
      } catch (error) {
        recordCounter('meristem_audit_write_failures_total', 1, { service: 'm-log' })
        throw error
      }

      if (readModel.isAvailable()) {
        scheduleProjection('audit', entry.id, () => opensearch.indexAuditLog(entry))
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
    },
    async writeDeploymentEvidence(request: {
      operationId: string
      correlationId: string
      auditId: string
      evidenceType: MDeployEvidenceTypeFromSchema
      digest: MDeployDigestFromSchema
    }): Promise<MDeployStorageRefV01FromSchema> {
      const id = crypto.randomUUID()
      await db.insert(deploymentEvidence).values({
        id,
        operationId: request.operationId,
        correlationId: request.correlationId,
        auditId: request.auditId,
        evidenceType: request.evidenceType,
        digest: request.digest,
        createdAt: new Date()
      })
      return {
        uri: `m-log://evidence/${id}`,
        digest: request.digest,
        redactionStatus: 'redacted'
      }
    }
  }
}
