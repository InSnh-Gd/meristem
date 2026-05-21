import { Elysia, t } from 'elysia'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent, joinSessionUrl } from '../middleware/helpers.ts'
import { apiError } from '../errors.ts'
import {
  apiErrorSchema,
  dependenciesSchema,
  nodeSchema,
  taskSchema,
  networkSchema,
  networkSummarySchema,
  networkMemberSchema,
  policyDecisionSchema,
  timelineLogSchema,
  fullLogSchema,
  auditLogSchema,
  serviceSummarySchema,
  protectedRouteDetail,
  protectedResponse
} from '../schemas.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'


export function healthRoutes(deps: CoreDeps, degradedEventOpen: { value: boolean }) {
  return new Elysia()
    .get('/api/v0/health', () => ({
      ok: true as const,
      service: 'meristem-core' as const,
      version: deps.version,
      uptimeMs: Date.now() - deps.startedAt
    }), {
      response: t.Object({
        ok: t.Literal(true),
        service: t.Literal('meristem-core'),
        version: t.String(),
        uptimeMs: t.Number()
      })
    })
    // 会话端点供 UI 和 BFF 在不触发授权的情况下读取当前操作者身份和权限列表。
    .get('/api/v0/session', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response

      const permissions = await deps.auth.getPermissions(auth.actor)
      if (!permissions.ok) return apiError(status, 503, permissions.error.code, permissions.error.message, auth.correlationId)

      return { actor: auth.actor, permissions: permissions.value }
    }, {
      response: {
        200: t.Object({
          actor: t.Union([t.Literal('viewer'), t.Literal('operator'), t.Literal('admin'), t.Literal('security-admin')]),
          permissions: t.Array(t.Union([
            t.Literal('core:read'), t.Literal('node:register'), t.Literal('node:issue-token'),
            t.Literal('task:assign'), t.Literal('timeline:read'), t.Literal('log:read-full'),
            t.Literal('audit:read'), t.Literal('service:register'), t.Literal('service:reload'),
            t.Literal('network:read'), t.Literal('network:create'), t.Literal('network:join')
          ]))
        }),
        401: apiErrorSchema
      },
      detail: protectedRouteDetail('Read current session identity and permissions')
    })
    .get('/api/v0/ready', async ({ headers }) =>
      withExtractedSpan('meristem-core', 'core.ready', headers, async () => {
        const dependencies = await deps.storage.readiness()
        const ready = Object.values(dependencies).every((dependency) => dependency === 'ready')
        if (!ready && !degradedEventOpen.value) {
          degradedEventOpen.value = true
          await deps.events.publish(
            'core.lifecycle.degraded.v0',
            tracedEvent({
              type: 'core.lifecycle.degraded',
              source: 'meristem-core',
              payload: { dependencies }
            })
          )
        }
        if (ready) degradedEventOpen.value = false
        return { ready, dependencies }
      })
    , {
      response: t.Object({
        ready: t.Boolean(),
        dependencies: dependenciesSchema
      })
    })
    .get('/api/v0/status', async ({ headers, status }) =>
      withExtractedSpan('meristem-core', 'core.status', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'core:read', resource: 'core', correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const dependencies = await deps.storage.readiness()
        const counts = await deps.storage.counts()
        return {
          core: { id: 'meristem-core', version: deps.version, mode: 'normal' as const },
          dependencies,
          counts
        }
      })
    , {
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
    })
}
