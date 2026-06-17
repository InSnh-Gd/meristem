import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import {
  apiErrorSchema,
  dependenciesSchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  readCoreReadiness,
  readSession,
  requireCoreStatusRead,
  sessionActorIds,
  sessionPermissions
} from './health-support.ts'

export function healthRoutes(deps: CoreDeps, degradedEventOpen: { value: boolean }) {
  return (
    new Elysia()
      .get(
        '/api/v0/health',
        () => ({
          ok: true as const,
          service: 'meristem-core' as const,
          version: deps.version,
          uptimeMs: Date.now() - deps.startedAt
        }),
        {
          response: t.Object({
            ok: t.Literal(true),
            service: t.Literal('meristem-core'),
            version: t.String(),
            uptimeMs: t.Number()
          })
        }
      )
      // 会话端点供 UI 和 BFF 在不触发授权的情况下读取当前操作者身份和权限列表。
      .get(
        '/api/v0/session',
        async ({ headers, status: _status }) => readSession(deps, headers),
        {
          response: {
            200: t.Object({
              actor: t.UnionEnum(sessionActorIds),
              permissions: t.Array(t.UnionEnum(sessionPermissions))
            }),
            401: apiErrorSchema
          },
          detail: protectedRouteDetail('Read current session identity and permissions')
        }
      )
      .get(
        '/api/v0/ready',
        async ({ headers }) =>
          withExtractedSpan('meristem-core', 'core.ready', headers, async () =>
            readCoreReadiness(deps, degradedEventOpen)
          ),
        {
          response: t.Object({
            ready: t.Boolean(),
            dependencies: dependenciesSchema
          })
        }
      )
      .get(
        '/api/v0/status',
        async ({ headers, status: _status }) =>
          withExtractedSpan('meristem-core', 'core.status', headers, async () => {
            await requireCoreStatusRead(deps, headers)

            const dependencies = await deps.storage.readiness()
            const counts = await deps.storage.counts()
            return {
              core: { id: 'meristem-core', version: deps.version, mode: 'normal' as const },
              dependencies,
              counts
            }
          }),
        {
          response: protectedResponse(
            t.Object({
              core: t.Object({
                id: t.String(),
                version: t.String(),
                mode: t.Union([t.Literal('normal'), t.Literal('degraded'), t.Literal('safe')])
              }),
              dependencies: dependenciesSchema,
              counts: t.Object({
                services: t.Number(),
                nodes: t.Number(),
                tasks: t.Number()
              })
            })
          ),
          detail: protectedRouteDetail('Read Core runtime status')
        }
      )
  )
}
