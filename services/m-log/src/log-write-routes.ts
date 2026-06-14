import { Elysia, t } from 'elysia'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId, withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { LogAppDeps } from './deps.ts'
import {
  auditLogSchema,
  auditWriteBodySchema,
  fullLogSchema,
  fullWriteBodySchema,
  internalErrorSchema,
  timelineLogSchema,
  timelineWriteBodySchema
} from './route-schemas.ts'

/**
 * 三类日志写入继续保留原始 trace 注入与响应形状，避免事件顺序和调用方契约漂移。
 */
export function createLogWriteRoutes(deps: LogAppDeps) {
  return new Elysia()
    .post(
      '/internal/v0/timeline',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.timeline.write', headers, async () => ({
          entry: await deps.writeTimeline(body)
        }))
      },
      {
        body: timelineWriteBodySchema,
        response: {
          200: t.Object({ entry: timelineLogSchema }),
          401: internalErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/full',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.full.write', headers, async () => ({
          entry: await (() => {
            const traceId = body.traceId ?? currentTraceId()
            return deps.writeFull(traceId ? { ...body, traceId } : body)
          })()
        }))
      },
      {
        body: fullWriteBodySchema,
        response: {
          200: t.Object({ entry: fullLogSchema }),
          401: internalErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/audit',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.audit.write', headers, async () => ({
          entry: await (() => {
            const traceId = body.traceId ?? currentTraceId()
            return deps.writeAudit(traceId ? { ...body, traceId } : body)
          })()
        }))
      },
      {
        body: auditWriteBodySchema,
        response: {
          200: t.Object({ entry: auditLogSchema }),
          401: internalErrorSchema
        }
      }
    )
}
