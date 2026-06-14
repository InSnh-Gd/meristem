import { Elysia, t } from 'elysia'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { LogAppDeps } from './deps.ts'
import {
  auditLogSchema,
  fullLogSchema,
  internalErrorSchema,
  listQuerySchema,
  timelineLogSchema
} from './route-schemas.ts'

/**
 * PostgreSQL 列表读取保留原有 span 名称与 limit 边界，确保拆分后查询语义完全一致。
 */
export function createLogQueryRoutes(deps: LogAppDeps) {
  return new Elysia()
    .get(
      '/internal/v0/timeline',
      async ({ query, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.timeline.list', headers, async () => ({
          entries: await deps.listTimeline(query.limit)
        }))
      },
      {
        query: listQuerySchema,
        response: {
          200: t.Object({ entries: t.Array(timelineLogSchema) }),
          401: internalErrorSchema
        }
      }
    )
    .get(
      '/internal/v0/full',
      async ({ query, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.full.list', headers, async () => ({
          entries: await deps.listFull(query.limit)
        }))
      },
      {
        query: listQuerySchema,
        response: {
          200: t.Object({ entries: t.Array(fullLogSchema) }),
          401: internalErrorSchema
        }
      }
    )
    .get(
      '/internal/v0/audit',
      async ({ query, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.audit.list', headers, async () => ({
          entries: await deps.listAudit(query.limit)
        }))
      },
      {
        query: listQuerySchema,
        response: {
          200: t.Object({ entries: t.Array(auditLogSchema) }),
          401: internalErrorSchema
        }
      }
    )
}
