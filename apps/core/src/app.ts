import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  AssignTaskRequest,
  CreateNodeTicketRequest,
  Permission,
  RegisterNodeRequest
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope, type CreateEventInput } from '../../../packages/events/src/index.ts'
import { currentTraceId, withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import { apiError, correlationIdFromHeader } from './errors.ts'
import type { StatusFn } from './errors.ts'
import type { CoreDeps } from './types.ts'

type AuthContext =
  | { ok: true; actor: ActorId; correlationId: string }
  | { ok: false; response: never }

/**
 * Core 所有受保护路由都先经过这一层 Bearer Token 解析与本地 JWT 校验，
 * 这样后续策略、审计和事件链路都能复用统一的 actor 与 correlationId。
 */
async function requireActor<TStatus extends StatusFn>(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  status: TStatus
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    return { ok: false, response: apiError(status, 401, 'auth.missing_token', 'Bearer token is required', correlationId) }
  }

  const verified = await deps.auth.verify(token)
  if (!verified.ok) {
    const code = 'error' in verified ? verified.error.code : verified.code
    const message = 'error' in verified ? verified.error.message : verified.message
    return { ok: false, response: apiError(status, 401, code, message, correlationId) }
  }

  const actor = 'value' in verified ? verified.value.actor : verified.actor
  return { ok: true, actor, correlationId }
}

/**
 * Core 不直接做权限硬编码，而是统一委托给 M-Policy，并在这里集中处理
 * fail-closed、拒绝写 Full Log 以及对外 HTTP 错误映射。
 */
async function authorize<TStatus extends StatusFn>(
  deps: CoreDeps,
  input: { actor: ActorId; action: Permission; resource: string; correlationId: string },
  status: TStatus
) {
  const decision = await deps.policy.authorize(input)
  if (!decision.ok) {
    return {
      ok: false as const,
      response: apiError(status, 503, decision.error.code, decision.error.message, input.correlationId)
    }
  }

  if (decision.value.result === 'deny') {
    await deps.log.writeFull({
      level: 'warn',
      source: 'meristem-core',
      message: `permission denied: ${input.action}`,
      correlationId: input.correlationId,
      payload: { actor: input.actor, action: input.action, resource: input.resource, decisionId: decision.value.id }
    })

    return {
      ok: false as const,
      response: apiError(status, 403, 'policy.denied', 'permission denied', input.correlationId)
    }
  }

  return { ok: true as const, decision: decision.value }
}

/**
 * 内部服务错误码在 Core 侧收敛为稳定的 HTTP 状态码，避免不同入口出现分裂语义。
 */
function statusCodeForServiceError(code: string): 404 | 409 | 503 {
  switch (code) {
    case 'network.not_found':
    case 'node.not_found':
    case 'task.not_found':
      return 404
    case 'network.conflict':
    case 'network.stem_required':
    case 'node.invalid_kind':
    case 'node.invalid_status':
    case 'node.unreachable':
    case 'node.credential_missing':
    case 'service.not_reloadable':
      return 409
    case 'service.not_found':
      return 404
    case 'mnet.unavailable':
    case 'nodeagent.unavailable':
    case 'nodeagent.invalid_token':
      return 503
    default:
      return 503
  }
}

/**
 * Core 发布事件时优先继承当前 traceId，保证 HTTP 请求、内部服务调用
 * 与异步事件在 OTel 和日志中可串联。
 */
function tracedEvent(input: CreateEventInput) {
  const traceId = currentTraceId()
  return createEventEnvelope({
    ...input,
    ...(traceId ? { traceId } : {})
  })
}

/**
 * Join ingress 对外只暴露固定 session 路径；Core 在签发 ticket 时统一生成该公网 URL，
 * 避免 CLI、UI 或文档各自拼接出不同的入口地址。
 */
function joinSessionUrl(publicUrl: string): string {
  const base = new URL(publicUrl)
  base.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/join/v0/session`
  base.search = ''
  base.hash = ''
  return base.toString()
}

const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

const dependencyStateSchema = t.Union([t.Literal('ready'), t.Literal('unavailable')])

const dependenciesSchema = t.Object({
  postgres: dependencyStateSchema,
  nats: dependencyStateSchema,
  'm-policy': dependencyStateSchema,
  'm-log': dependencyStateSchema,
  'm-eventbus': dependencyStateSchema,
  'm-net': dependencyStateSchema
})

const serviceLifecycleSchema = t.Object({
  reloadable: t.Boolean(),
  rollbackable: t.Boolean(),
  degradable: t.Boolean()
})

const serviceRuntimeSchema = t.Object({
  liveness: t.Boolean(),
  readiness: t.Boolean(),
  mode: t.Union([t.Literal('normal'), t.Literal('degraded')]),
  lastError: t.Optional(t.String()),
  lastReloadedAt: t.Optional(t.String())
})

const serviceSummarySchema = t.Object({
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

const nodeSchema = t.Object({
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

const taskSchema = t.Object({
  id: t.String(),
  leafNodeId: t.String(),
  type: t.Literal('noop'),
  status: t.Union([t.Literal('requested'), t.Literal('completed'), t.Literal('failed')]),
  createdAt: t.String(),
  completedAt: t.Optional(t.String())
})

const networkSchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String()
})

const networkSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String(),
  memberCount: t.Number()
})

const networkMemberSchema = t.Object({
  networkId: t.String(),
  nodeId: t.String(),
  nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  membershipMode: t.Union([t.Literal('full'), t.Literal('restricted')]),
  status: t.Literal('joined'),
  joinedAt: t.String()
})

const policyDecisionSchema = t.Object({
  id: t.String(),
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin')
  ]),
  action: t.Union([
    t.Literal('core:read'),
    t.Literal('node:register'),
    t.Literal('node:issue-token'),
    t.Literal('task:assign'),
    t.Literal('timeline:read'),
    t.Literal('log:read-full'),
    t.Literal('audit:read'),
    t.Literal('service:register'),
    t.Literal('service:reload'),
    t.Literal('network:read'),
    t.Literal('network:create'),
    t.Literal('network:join')
  ]),
  resource: t.String(),
  result: t.Union([t.Literal('allow'), t.Literal('deny')]),
  reasons: t.Array(t.String()),
  createdAt: t.String()
})

const timelineLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.String(),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

const fullLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String(),
  message: t.String(),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

const auditLogSchema = t.Object({
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

function protectedRouteDetail(summary: string) {
  return { security: [{ bearerAuth: [] }], summary }
}

function protectedResponse<
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

export function createCoreApp(deps: CoreDeps) {
  let degradedEventOpen = false

  return new Elysia()
    .use(
      openapi({
        documentation: {
          info: { title: 'Meristem Core API', version: 'v0' },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
              }
            }
          }
        }
      })
    )
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
        if (!ready && !degradedEventOpen) {
          degradedEventOpen = true
          await deps.events.publish(
            'core.lifecycle.degraded.v0',
            tracedEvent({
              type: 'core.lifecycle.degraded',
              source: 'meristem-core',
              payload: {
                dependencies
              }
            })
          )
        }
        if (ready) degradedEventOpen = false
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
    // 服务生命周期入口保持在 Core，对外统一暴露注册、枚举和 reload。
    // 这段方法链显式写出鉴权、审计、事件与失败路径，避免 Elysia 链式调用失去可读性。
    .post('/api/v0/services', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.service.register', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'service:register', resource: 'service-definition', correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'service:register',
          resource: 'service-definition',
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const service = await deps.storage.registerService(body)
        await deps.events.publish(
          'service.lifecycle.registered.v0',
          tracedEvent({
            type: 'service.lifecycle.registered',
            source: 'meristem-core',
            payload: service,
            correlationId: auth.correlationId
          })
        )
        return { service, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      })
    }, {
      response: protectedResponse(
        t.Object({
          service: t.Unknown(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Register a service definition')
    })
    .get('/api/v0/services', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'services', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const services = await deps.services.list()
      if (!services.ok) {
        return apiError(status, 503, services.error.code, services.error.message, auth.correlationId)
      }
      return { services: services.value }
    }, {
      response: protectedResponse(
        t.Object({
          services: t.Array(serviceSummarySchema)
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List service runtime summaries')
    })
    .post('/api/v0/services/:id/reload', async ({ params, body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.service.reload', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'service:reload', resource: `service:${params.id}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'service:reload',
          resource: `service:${params.id}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId,
          payload: body.reason ? { reason: body.reason } : undefined
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        await deps.events.publish(
          'service.lifecycle.reload.requested.v0',
          tracedEvent({
            type: 'service.lifecycle.reload.requested',
            source: 'meristem-core',
            payload: { serviceId: params.id, ...(body.reason ? { reason: body.reason } : {}) },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `requested reload for service ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })

        const reloaded = await deps.services.reload({
          serviceId: params.id,
          correlationId: auth.correlationId,
          ...(body.reason ? { reason: body.reason } : {})
        })
        if (!reloaded.ok) {
          await deps.events.publish(
            'service.lifecycle.reload.failed.v0',
            tracedEvent({
              type: 'service.lifecycle.reload.failed',
              source: 'meristem-core',
              payload: { serviceId: params.id, code: reloaded.error.code, message: reloaded.error.message },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeFull({
            level: 'error',
            source: 'meristem-core',
            message: `service reload failed for ${params.id}`,
            correlationId: auth.correlationId,
            payload: { code: reloaded.error.code, message: reloaded.error.message }
          })
          return apiError(
            status,
            statusCodeForServiceError(reloaded.error.code),
            reloaded.error.code,
            reloaded.error.message,
            auth.correlationId
          )
        }

        await deps.log.writeTimeline({
          summary: `reloaded service ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })

        return {
          serviceId: reloaded.value.serviceId,
          accepted: true as const,
          reloadedAt: reloaded.value.reloadedAt,
          policyDecisionId: permission.decision.id,
          correlationId: auth.correlationId
        }
      })
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      body: t.Object({
        reason: t.Optional(t.String())
      }),
      response: protectedResponse(
        t.Object({
          serviceId: t.String(),
          accepted: t.Literal(true),
          reloadedAt: t.String(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Reload a reloadable service')
    })
    // 网络路由继续由 Core 暴露外部契约，M-Net 持有权威网络状态和成员规则。
    // Core 侧必须清晰保留“鉴权 -> 审计 -> 状态写入 -> 事件发布”的编排顺序。
    .post(
      '/api/v0/networks',
      async ({ body, headers, status }) => {
        return withExtractedSpan('meristem-core', 'core.network.create', headers, async () => {
          const auth = await requireActor(deps, headers, status)
          if (!auth.ok) return auth.response
          const permission = await authorize(
            deps,
            { actor: auth.actor, action: 'network:create', resource: `network:${body.name}`, correlationId: auth.correlationId },
            status
          )
          if (!permission.ok) return permission.response

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'network:create',
            resource: `network:${body.name}`,
            decisionId: permission.decision.id,
            result: permission.decision.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

          const created = await deps.mNet.createNetwork(body)
          if (!created.ok) {
            return apiError(
              status,
              statusCodeForServiceError(created.error.code),
              created.error.code,
              created.error.message,
              auth.correlationId
            )
          }

          await deps.events.publish(
            'mnet.network.created.v0',
            tracedEvent({
              type: 'mnet.network.created',
              source: 'meristem-core',
              payload: {
                networkId: created.value.id,
                name: created.value.name,
                profileVersion: created.value.profileVersion
              },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `created network ${created.value.name}`,
            subject: created.value.id,
            correlationId: auth.correlationId
          })

          return { network: created.value, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
        })
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          profileVersion: t.Optional(t.String({ minLength: 1 }))
        }),
      response: protectedResponse(
        t.Object({
          network: networkSchema,
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 409: apiErrorSchema, 503: apiErrorSchema }
      ),
        detail: protectedRouteDetail('Create a logical network')
      }
    )
    .get('/api/v0/networks', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'network:read', resource: 'networks', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const networks = await deps.mNet.listNetworks()
      if (!networks.ok) {
        return apiError(
          status,
          statusCodeForServiceError(networks.error.code),
          networks.error.code,
          networks.error.message,
          auth.correlationId
        )
      }
      return { networks: networks.value }
    }, {
      response: protectedResponse(
        t.Object({
          networks: t.Array(networkSummarySchema)
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List logical networks')
    })
    .post(
      '/api/v0/networks/:id/members',
      async ({ params, body, headers, status }) => {
        return withExtractedSpan('meristem-core', 'core.network.join', headers, async () => {
          const auth = await requireActor(deps, headers, status)
          if (!auth.ok) return auth.response
          const permission = await authorize(
            deps,
            {
              actor: auth.actor,
              action: 'network:join',
              resource: `network:${params.id}:node:${body.nodeId}`,
              correlationId: auth.correlationId
            },
            status
          )
          if (!permission.ok) return permission.response

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'network:join',
            resource: `network:${params.id}:node:${body.nodeId}`,
            decisionId: permission.decision.id,
            result: permission.decision.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

          const member = await deps.mNet.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
          if (!member.ok) {
            return apiError(
              status,
              statusCodeForServiceError(member.error.code),
              member.error.code,
              member.error.message,
              auth.correlationId
            )
          }

          await deps.events.publish(
            'mnet.membership.joined.v0',
            tracedEvent({
              type: 'mnet.membership.joined',
              source: 'meristem-core',
              payload: {
                networkId: member.value.networkId,
                nodeId: member.value.nodeId,
                nodeKind: member.value.nodeKind,
                membershipMode: member.value.membershipMode
              },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `joined node ${member.value.nodeId} to network ${member.value.networkId}`,
            subject: member.value.networkId,
            correlationId: auth.correlationId
          })

          return { member: member.value, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
        })
      },
      {
        body: t.Object({
          nodeId: t.String({ minLength: 1 })
        }),
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
      response: protectedResponse(
        t.Object({
          member: networkMemberSchema,
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
      ),
        detail: protectedRouteDetail('Join a node to a logical network')
      }
    )
    .get('/api/v0/networks/:id/members', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'network:read', resource: `network:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const members = await deps.mNet.listNetworkMembers(params.id)
      if (!members.ok) {
        return apiError(
          status,
          statusCodeForServiceError(members.error.code),
          members.error.code,
          members.error.message,
          auth.correlationId
        )
      }
      return { members: members.value }
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      response: protectedResponse(
        t.Object({
          members: t.Array(networkMemberSchema)
        }),
        { 404: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List network members')
    })
    // Join Ticket 是公网 agent 加入的唯一入口；Core 负责鉴权、策略、审计和一次性票据签发，
    // 真正的节点创建与运行 token 签发在 M-Net 兑换成功时完成。
    .post(
      '/api/v0/node-tickets',
      async ({ body, headers, status }) => {
        return withExtractedSpan('meristem-core', 'core.node.ticket.create', headers, async () => {
          const auth = await requireActor(deps, headers, status)
          if (!auth.ok) return auth.response

          const permission = await authorize(
            deps,
            { actor: auth.actor, action: 'node:register', resource: `node:${body.kind}:${body.name}`, correlationId: auth.correlationId },
            status
          )
          if (!permission.ok) return permission.response

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`,
            decisionId: permission.decision.id,
            result: permission.decision.result,
            correlationId: auth.correlationId,
            payload: { channel: 'join-ticket' }
          })
          if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

          await deps.events.publish(
            'node.registration.requested.v0',
            tracedEvent({
              type: 'node.registration.requested',
              source: 'meristem-core',
              payload: { kind: body.kind, name: body.name, channel: 'join-ticket' },
              correlationId: auth.correlationId
            })
          )

          const ticket = await deps.storage.createNodeTicket({ ...body, createdBy: auth.actor })
          await deps.events.publish(
            'node.join-ticket.created.v0',
            tracedEvent({
              type: 'node.join-ticket.created',
              source: 'meristem-core',
              payload: { ticketId: ticket.ticketId, kind: body.kind, name: body.name, expiresAt: ticket.expiresAt },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `created join ticket for ${body.kind} node ${body.name}`,
            subject: ticket.ticketId,
            correlationId: auth.correlationId
          })

          return {
            ticketId: ticket.ticketId,
            ticket: ticket.ticket,
            expiresAt: ticket.expiresAt,
            joinUrl: joinSessionUrl(deps.joinIngressPublicUrl),
            policyDecisionId: permission.decision.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
          name: t.String({ minLength: 1 }),
          capabilities: t.Optional(t.Array(t.String())),
          expiresInSeconds: t.Optional(t.Number({ minimum: 30, maximum: 3600 }))
        }),
      response: protectedResponse(
        t.Object({
          ticketId: t.String(),
          ticket: t.String(),
          expiresAt: t.String(),
          joinUrl: t.String(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 503: apiErrorSchema }
      ),
        detail: protectedRouteDetail('Create a one-time node join ticket')
      }
    )
    // 公共 node register 现在只保留 simulated 节点；agent 节点必须经由 Join Ticket + M-Net ingress 接入。
    .post(
      '/api/v0/nodes',
      async ({ body, headers, status }) => {
        return withExtractedSpan('meristem-core', 'core.node.register', headers, async () => {
          const auth = await requireActor(deps, headers, status)
          if (!auth.ok) return auth.response

          const requestedMode = Reflect.get(body as object, 'mode')
          if (requestedMode === 'agent') {
            return apiError(
              status,
              409,
              'node.agent_join_ticket_required',
              'agent nodes must join through node ticket create and the M-Net join ingress',
              auth.correlationId
            )
          }

          const permission = await authorize(
            deps,
            { actor: auth.actor, action: 'node:register', resource: `node:${body.kind}:${body.name}`, correlationId: auth.correlationId },
            status
          )
          if (!permission.ok) return permission.response

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`,
            decisionId: permission.decision.id,
            result: permission.decision.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok) {
            return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)
          }

          await deps.events.publish(
            'node.registration.requested.v0',
            tracedEvent({
              type: 'node.registration.requested',
              source: 'meristem-core',
              payload: { kind: body.kind, name: body.name },
              correlationId: auth.correlationId
            })
          )

          const node = await deps.storage.registerNode({
            kind: body.kind,
            name: body.name,
            ...(body.capabilities ? { capabilities: body.capabilities } : {}),
            ...(requestedMode === 'simulated' ? { mode: 'simulated' as const } : {})
          })
          await deps.events.publish(
            'node.registration.accepted.v0',
            tracedEvent({
              type: 'node.registration.accepted',
              source: 'meristem-core',
              payload: { nodeId: node.id, kind: node.kind, mode: node.mode },
              correlationId: auth.correlationId
            })
          )
          if (node.status !== 'joining') {
            await deps.events.publish(
              'node.status.changed.v0',
              tracedEvent({
                type: 'node.status.changed',
                source: 'meristem-core',
                payload: {
                  nodeId: node.id,
                  previousStatus: 'joining',
                  nextStatus: node.status
                },
                correlationId: auth.correlationId
              })
            )
          }
          await deps.log.writeTimeline({
            summary: `registered ${node.kind} node ${node.name}`,
            subject: node.id,
            correlationId: auth.correlationId
          })

          return {
            node,
            policyDecisionId: permission.decision.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
          name: t.String({ minLength: 1 }),
          mode: t.Optional(t.Union([t.Literal('agent'), t.Literal('simulated')])),
          capabilities: t.Optional(t.Array(t.String()))
        }),
      response: protectedResponse(
        t.Object({
          node: nodeSchema,
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 409: apiErrorSchema, 503: apiErrorSchema }
      ),
        detail: protectedRouteDetail('Register Stem or Leaf node')
      }
    )
    .post('/api/v0/nodes/:id/credentials', async ({ params, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.node.issue-token', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'node:issue-token', resource: `node:${params.id}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'node:issue-token',
          resource: `node:${params.id}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const credential = await deps.storage.issueNodeCredential(params.id)
        if (!credential) return apiError(status, 404, 'node.not_found', 'node not found', auth.correlationId)

        await deps.log.writeTimeline({
          summary: `issued node token for ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })

        return {
          nodeId: credential.nodeId,
          token: credential.token,
          issuedAt: credential.issuedAt,
          policyDecisionId: permission.decision.id,
          correlationId: auth.correlationId
        }
      })
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      response: protectedResponse(
        t.Object({
          nodeId: t.String(),
          token: t.String(),
          issuedAt: t.String(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 404: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Issue a node credential')
    })
    .get('/api/v0/nodes', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'nodes', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      return { nodes: await deps.storage.listNodes() }
    }, {
      response: protectedResponse(
        t.Object({
          nodes: t.Array(nodeSchema)
        })
      ),
      detail: protectedRouteDetail('List nodes')
    })
    .get('/api/v0/nodes/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `node:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const node = await deps.storage.getNode(params.id)
      return node ? { node } : apiError(status, 404, 'node.not_found', 'node not found', auth.correlationId)
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      response: protectedResponse(
        t.Object({
          node: nodeSchema
        }),
        { 404: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Read one node')
    })
    // 任务分配在 simulated 与 agent 模式之间走不同执行路径，
    // 这里保留状态校验、token 校验和失败码映射的可读性。
    .post(
      '/api/v0/tasks',
      async ({ body, headers, status }) => {
        return withExtractedSpan('meristem-core', 'core.task.assign', headers, async () => {
          const auth = await requireActor(deps, headers, status)
          if (!auth.ok) return auth.response
          const permission = await authorize(
            deps,
            { actor: auth.actor, action: 'task:assign', resource: `node:${body.leafNodeId}`, correlationId: auth.correlationId },
            status
          )
          if (!permission.ok) return permission.response

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'task:assign',
            resource: `node:${body.leafNodeId}`,
            decisionId: permission.decision.id,
            result: permission.decision.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

          await deps.events.publish(
            'task.assignment.requested.v0',
            tracedEvent({
              type: 'task.assignment.requested',
              source: 'meristem-core',
              payload: {
                leafNodeId: body.leafNodeId,
                type: body.type,
                actor: auth.actor
              },
              correlationId: auth.correlationId
            })
          )

          const node = await deps.storage.getNode(body.leafNodeId)
          if (!node) return apiError(status, 404, 'node.not_found', 'node not found', auth.correlationId)
          if (node.kind !== 'leaf') {
            return apiError(status, 409, 'node.invalid_kind', 'target must be a Leaf node', auth.correlationId)
          }

          const task = node.mode === 'simulated'
            ? await deps.storage.assignTask(body)
            : await (async () => {
                if (node.reachability !== 'reachable' || (node.status !== 'healthy' && node.status !== 'degraded')) {
                  throw { code: 'node.unreachable', message: 'node is unreachable' }
                }
                const hasCredential = await deps.storage.hasActiveNodeCredential(node.id)
                if (!hasCredential) throw { code: 'node.credential_missing', message: 'node does not have an active credential' }
                const requestedTask = await deps.storage.createTaskRequest(body)
                const executed = await deps.agentTasks.executeNoop({
                  nodeId: node.id,
                  taskId: requestedTask.id,
                  correlationId: auth.correlationId
                })
                if (!executed.ok) throw executed.error
                const completed = await deps.storage.completeTask({
                  taskId: requestedTask.id,
                  completedAt: executed.value.completedAt
                })
                if (!completed) throw { code: 'task.not_found', message: 'task not found' }
                return completed
              })().catch((error: unknown) => {
                const failure = typeof error === 'object' && error !== null
                  ? {
                      code: String(Reflect.get(error, 'code') ?? 'nodeagent.unavailable'),
                      message: String(Reflect.get(error, 'message') ?? 'node agent unavailable')
                    }
                  : { code: 'nodeagent.unavailable', message: 'node agent unavailable' }
                return failure
              })

          if ('code' in task) {
            return apiError(
              status,
              statusCodeForServiceError(task.code),
              task.code,
              task.message,
              auth.correlationId
            )
          }

          await deps.events.publish(
            'task.assignment.completed.v0',
            tracedEvent({
              type: 'task.assignment.completed',
              source: 'meristem-core',
              payload: { taskId: task.id, leafNodeId: task.leafNodeId, type: task.type },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `completed noop task ${task.id}`,
            subject: task.id,
            correlationId: auth.correlationId
          })

          return { task, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
        })
      },
      {
        body: t.Object({
          leafNodeId: t.String(),
          type: t.Literal('noop')
        }),
      response: protectedResponse(
        t.Object({
          task: taskSchema,
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
      ),
        detail: protectedRouteDetail('Assign a noop task to a leaf node')
      }
    )
    .get('/api/v0/tasks/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `task:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const task = await deps.storage.getTask(params.id)
      return task ? { task } : apiError(status, 404, 'task.not_found', 'task not found', auth.correlationId)
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      response: protectedResponse(
        t.Object({
          task: taskSchema
        }),
        { 404: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Read one task')
    })
    // 日志与策略查询保持只读聚合职责，Core 在这里只做鉴权和错误映射，不重算事实。
    .get('/api/v0/logs/timeline', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'timeline:read', resource: 'timeline', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listTimeline()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(
        t.Object({
          entries: t.Array(timelineLogSchema)
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List timeline logs')
    })
    .get('/api/v0/logs/full', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'log:read-full', resource: 'full-log', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listFull()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(
        t.Object({
          entries: t.Array(fullLogSchema)
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List full logs')
    })
    .get('/api/v0/audit', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'audit:read', resource: 'audit', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listAudit()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(
        t.Object({
          entries: t.Array(auditLogSchema)
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List audit logs')
    })
    .get('/api/v0/policy/decisions/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `policy-decision:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const decision = await deps.policy.getDecision(params.id)
      if (!decision.ok) return apiError(status, 503, decision.error.code, decision.error.message, auth.correlationId)
      return decision.value ? { decision: decision.value } : apiError(status, 404, 'policy_decision.not_found', 'policy decision not found', auth.correlationId)
    }, {
      params: t.Object({
        id: t.String({ minLength: 1 })
      }),
      response: protectedResponse(
        t.Object({
          decision: policyDecisionSchema
        }),
        { 404: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Read one policy decision')
    })
}

export type CoreApp = ReturnType<typeof createCoreApp>
