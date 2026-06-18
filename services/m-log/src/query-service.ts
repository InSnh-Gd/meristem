import { desc } from 'drizzle-orm'
import type {
  ActorId,
  AuditLog,
  FullLog,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { auditLogs, fullLogs, timelineLogs } from '../../../packages/db/src/schema.ts'

export function createLogQueryService(db: MeristemDb) {
  return {
    async listTimeline(limit?: number): Promise<TimelineLog[]> {
      const rows = await db
        .select()
        .from(timelineLogs)
        .orderBy(desc(timelineLogs.timestamp))
        .limit(limit ?? 50)
      return rows.map(row => {
        const entry: TimelineLog = {
          id: row.id,
          timestamp: row.timestamp.toISOString(),
          summary: row.summary
        }
        if (row.subject) entry.subject = row.subject
        if (row.correlationId) entry.correlationId = row.correlationId
        return entry
      })
    },
    async listFull(limit?: number): Promise<FullLog[]> {
      const rows = await db
        .select()
        .from(fullLogs)
        .orderBy(desc(fullLogs.timestamp))
        .limit(limit ?? 50)
      return rows.map(row => {
        const entry: FullLog = {
          id: row.id,
          timestamp: row.timestamp.toISOString(),
          level: row.level as FullLog['level'],
          source: row.source,
          message: row.message
        }
        if (row.correlationId) entry.correlationId = row.correlationId
        if (row.traceId) entry.traceId = row.traceId
        if (row.payload) entry.payload = row.payload
        return entry
      })
    },
    async listAudit(limit?: number): Promise<AuditLog[]> {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit ?? 50)
      return rows.map(row => {
        const entry: AuditLog = {
          id: row.id,
          timestamp: row.timestamp.toISOString(),
          actor: row.actor as ActorId | 'system',
          action: row.action,
          resource: row.resource,
          result: row.result
        }
        if (row.decisionId) entry.decisionId = row.decisionId
        if (row.correlationId) entry.correlationId = row.correlationId
        if (row.traceId) entry.traceId = row.traceId
        if (row.payload) entry.payload = row.payload
        return entry
      })
    }
  }
}
