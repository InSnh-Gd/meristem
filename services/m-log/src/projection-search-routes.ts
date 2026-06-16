import { Elysia, t } from 'elysia'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import type { LogAppDeps } from './deps.ts'
import {
  toAuditSearchQuery,
  toBackfillParams,
  toFullSearchQuery,
  toTimelineSearchQuery
} from './route-helpers.ts'
import {
  auditLogSchema,
  auditSearchQuerySchema,
  backfillParamsSchema,
  backfillResultSchema,
  degradedSearchSchema,
  dlqRecordSchema,
  fullLogSchema,
  fullSearchQuerySchema,
  internalErrorSchema,
  logSearchResultSchema,
  projectionHealthSchema,
  timelineLogSchema,
  timelineSearchQuerySchema
} from './route-schemas.ts'

type ErrorResponse = { error: { code: string; message: string } }

/**
 * 搜索与投影管理路由共享同一内部边界：依赖不可用时返回 503，避免把降级细节泄漏给 facade。
 */
export function createProjectionSearchRoutes(deps: LogAppDeps) {
  return (
    new Elysia()
      .get(
        '/internal/v0/search/full',
        async ({ query, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.search.isAvailable()) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'OpenSearch is not available' }
            }) as unknown as ErrorResponse
          }
          const result = await deps.search.full(toFullSearchQuery(query))
          if (!result) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'search query failed' }
            }) as unknown as ErrorResponse
          }
          return result
        },
        {
          query: fullSearchQuerySchema,
          response: {
            200: logSearchResultSchema(fullLogSchema),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      .get(
        '/internal/v0/search/timeline',
        async ({ query, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.search.isAvailable()) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'OpenSearch is not available' }
            }) as unknown as ErrorResponse
          }
          const result = await deps.search.timeline(toTimelineSearchQuery(query))
          if (!result) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'search query failed' }
            }) as unknown as ErrorResponse
          }
          return result
        },
        {
          query: timelineSearchQuerySchema,
          response: {
            200: logSearchResultSchema(timelineLogSchema),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      .get(
        '/internal/v0/search/audit',
        async ({ query, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.search.isAvailable()) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'OpenSearch is not available' }
            }) as unknown as ErrorResponse
          }
          const result = await deps.search.audit(toAuditSearchQuery(query))
          if (!result) {
            return status(503, {
              error: { code: 'search_unavailable', message: 'search query failed' }
            }) as unknown as ErrorResponse
          }
          return result
        },
        {
          query: auditSearchQuerySchema,
          response: {
            200: logSearchResultSchema(auditLogSchema),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      // 投影健康端点继续暴露 lag、pending、DLQ 可观测字段。
      .get(
        '/internal/v0/projection/health',
        async ({ headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.projection.isAvailable()) {
            return status(503, {
              error: {
                code: 'projection_unavailable',
                message: 'projection engine is not available'
              }
            }) as unknown as ErrorResponse
          }
          const health = await deps.projection.getProjectionHealth()
          return { indices: health }
        },
        {
          response: {
            200: t.Object({ indices: t.Array(projectionHealthSchema) }),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      // Backfill 仍通过内部 HTTP 触发，并保持原始参数归一化与错误边界。
      .post(
        '/internal/v0/projection/backfill',
        async ({ body, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.projection.isAvailable()) {
            return status(503, {
              error: {
                code: 'projection_unavailable',
                message: 'projection engine is not available'
              }
            }) as unknown as ErrorResponse
          }
          try {
            return await deps.projection.executeBackfill(toBackfillParams(body))
          } catch (error) {
            return status(503, {
              error: {
                code: 'backfill_failed',
                message: error instanceof Error ? error.message : 'backfill failed'
              }
            }) as unknown as ErrorResponse
          }
        },
        {
          body: backfillParamsSchema,
          response: {
            200: backfillResultSchema,
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      .get(
        '/internal/v0/projection/dlq',
        async ({ query, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.projection.isAvailable()) {
            return status(503, {
              error: {
                code: 'projection_unavailable',
                message: 'projection engine is not available'
              }
            }) as unknown as ErrorResponse
          }
          const records = await deps.projection.listDLQ(query.index)
          return { records }
        },
        {
          query: t.Object({ index: t.Optional(t.String()) }),
          response: {
            200: t.Object({ records: t.Array(dlqRecordSchema) }),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      .post(
        '/internal/v0/projection/dlq/:id/replay',
        async ({ params, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.projection.isAvailable()) {
            return status(503, {
              error: {
                code: 'projection_unavailable',
                message: 'projection engine is not available'
              }
            }) as unknown as ErrorResponse
          }
          const success = await deps.projection.replayDLQ(params.id)
          if (!success) {
            return status(404, {
              error: {
                code: 'dlq_not_found_or_replay_failed',
                message: 'DLQ record not found or replay failed'
              }
            }) as unknown as ErrorResponse
          }
          return { replayed: true }
        },
        {
          response: {
            200: t.Object({ replayed: t.Boolean() }),
            401: internalErrorSchema,
            404: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
      .post(
        '/internal/v0/projection/dlq/:id/skip',
        async ({ params, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error }) as unknown as ErrorResponse
          if (!deps.projection.isAvailable()) {
            return status(503, {
              error: {
                code: 'projection_unavailable',
                message: 'projection engine is not available'
              }
            }) as unknown as ErrorResponse
          }
          await deps.projection.skipDLQ(params.id)
          return { skipped: true }
        },
        {
          response: {
            200: t.Object({ skipped: t.Boolean() }),
            401: internalErrorSchema,
            503: degradedSearchSchema
          }
        }
      )
  )
}
