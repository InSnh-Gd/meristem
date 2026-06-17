import { Elysia, t } from 'elysia'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { LogAppDeps } from './deps.ts'
import { internalErrorSchema, readyResponseSchema, reloadBodySchema } from './route-schemas.ts'

/**
 * 健康与生命周期路由单独成层，保持 facade 只做组装并维持原有鉴权与错误语义。
 */
export function createHealthAdminRoutes(deps: LogAppDeps) {
  return (
    new Elysia()
      .get('/health', () => ({
        ok: true as const,
        service: 'm-log' as const,
        opensearch: deps.search.isAvailable() ? ('ready' as const) : ('unavailable' as const)
      }))
      .get(
        '/ready',
        async ({ headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error })
          return withExtractedSpan('m-log', 'm-log.ready', headers, () => deps.readiness())
        },
        {
          response: {
            200: readyResponseSchema,
            401: internalErrorSchema
          }
        }
      )
      // 生命周期 reload 仅重载进程内状态，错误映射继续收敛到 503 边界。
      .post(
        '/internal/v0/lifecycle/reload',
        async ({ body, headers, status }) => {
          const auth = validateInternalRequest(headers)
          if (!auth.ok) return status(401, { error: auth.error })
          return withExtractedSpan('m-log', 'm-log.lifecycle.reload', headers, async () => {
            try {
              return await deps.reload(body)
            } catch (error) {
              return status(503, {
                error: {
                  code: 'service.reload_failed',
                  message: error instanceof Error ? error.message : 'service reload failed'
                }
              })
            }
          })
        },
        {
          body: reloadBodySchema,
          response: {
            200: t.Object({
              serviceId: t.String(),
              reloadedAt: t.String()
            }),
            401: internalErrorSchema,
            503: internalErrorSchema
          }
        }
      )
  )
}
