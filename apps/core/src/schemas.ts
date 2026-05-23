import { t } from 'elysia'
import { actorIds, permissions } from '../../../packages/contracts/src/index.ts'

/**
 * Core REST API 的共享 Elysia typebox schema。
 * 路由文件统一从这里引入 schema，保证 OpenAPI 输出一致且避免重复定义。
 */

export const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

export const dependencyStateSchema = t.Union([t.Literal('ready'), t.Literal('unavailable')])

export const dependenciesSchema = t.Object({
  postgres: dependencyStateSchema,
  nats: dependencyStateSchema,
  'm-policy': dependencyStateSchema,
  'm-log': dependencyStateSchema,
  'm-eventbus': dependencyStateSchema,
  'm-net': dependencyStateSchema
})

export const serviceLifecycleSchema = t.Object({
  reloadable: t.Boolean(),
  rollbackable: t.Boolean(),
  degradable: t.Boolean()
})

export const serviceRuntimeSchema = t.Object({
  liveness: t.Boolean(),
  readiness: t.Boolean(),
  mode: t.Union([t.Literal('normal'), t.Literal('degraded')]),
  lastError: t.Optional(t.String()),
  lastReloadedAt: t.Optional(t.String())
})

export const serviceSummarySchema = t.Object({
  id: t.String(),
  version: t.String(),
  domain: t.Union([
    t.Literal('core'),
    t.Literal('m-net'),
    t.Literal('m-eventbus'),
    t.Literal('m-log'),
    t.Literal('m-policy'),
    t.Literal('m-ui'),
    t.Literal('m-cli'),
    t.Literal('m-extension')
  ]),
  kind: t.Union([
    t.Literal('core'),
    t.Literal('internal'),
    t.Literal('node'),
    t.Literal('task'),
    t.Literal('extension'),
    t.Literal('bff')
  ]),
  lifecycle: serviceLifecycleSchema,
  runtime: t.Optional(serviceRuntimeSchema)
})

export const nodeSchema = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  name: t.String(),
  mode: t.Union([t.Literal('agent'), t.Literal('simulated')]),
  status: t.Union([
    t.Literal('joining'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('offline'),
    t.Literal('revoked')
  ]),
  reachability: t.Union([t.Literal('unknown'), t.Literal('reachable'), t.Literal('unreachable')]),
  lastSeenAt: t.Optional(t.String()),
  agentVersion: t.Optional(t.String()),
  capabilities: t.Array(t.String()),
  createdAt: t.String()
})

export const taskSchema = t.Object({
  id: t.String(),
  leafNodeId: t.String(),
  type: t.Literal('noop'),
  status: t.Union([t.Literal('requested'), t.Literal('completed'), t.Literal('failed')]),
  createdAt: t.String(),
  completedAt: t.Optional(t.String())
})

export const networkSchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String()
})

export const networkSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String(),
  memberCount: t.Number()
})

export const networkMemberSchema = t.Object({
  networkId: t.String(),
  nodeId: t.String(),
  nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  membershipMode: t.Union([t.Literal('full'), t.Literal('restricted')]),
  status: t.Literal('joined'),
  joinedAt: t.String()
})

export const policyDecisionSchema = t.Object({
  id: t.String(),
  actor: t.UnionEnum(actorIds),
  action: t.UnionEnum(permissions),
  resource: t.String(),
  result: t.Union([t.Literal('allow'), t.Literal('deny')]),
  reasons: t.Array(t.String()),
  createdAt: t.String()
})

export const timelineLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.String(),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const fullLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String(),
  message: t.String(),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

export const auditLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('system')
  ]),
  action: t.String(),
  resource: t.String(),
  decisionId: t.Optional(t.String()),
  result: t.String(),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

export function protectedRouteDetail(summary: string) {
  return { security: [{ bearerAuth: [] }], summary }
}

export function protectedResponse<
  TSuccess extends ReturnType<typeof t.Object>,
  const TExtra extends Record<number, ReturnType<typeof t.Object>> = {}
>(success: TSuccess, extra?: TExtra) {
  return {
    200: success,
    401: apiErrorSchema,
    403: apiErrorSchema,
    ...(extra ?? {})
  } as const
}
