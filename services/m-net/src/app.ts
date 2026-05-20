import { Elysia, t } from 'elysia'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeAgentTaskExecuteResponse
} from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

export type MNetServiceError = {
  code: string
  message: string
}

export type MNetServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MNetServiceError }

export type MNetAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>>
  listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>>
  joinNetwork(input: { networkId: string; nodeId: string }): Promise<MNetServiceResult<MNetworkMember>>
  listMembers(input: { networkId: string }): Promise<MNetServiceResult<MNetworkMember[]>>
  executeNoop(input: { nodeId: string; taskId: string; correlationId: string }): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>
}

const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
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

const taskExecuteResponseSchema = t.Object({
  nodeId: t.String(),
  taskId: t.String(),
  result: t.Literal('completed'),
  completedAt: t.String()
})

/**
 * internal HTTP 所有入口统一复用共享 token 校验，避免 Core -> M-Net 的 loopback 调用分散出多套认证逻辑。
 */
function requireInternal<TStatus extends (code: never, body: never) => unknown>(
  headers: Headers | Record<string, string | undefined>,
  _status: TStatus
): never | null {
  const auth = validateInternalRequest(headers)
  return auth.ok ? null : _status(401 as Parameters<TStatus>[0], { error: auth.error } as Parameters<TStatus>[1]) as never
}

function internalError<TStatus extends (code: never, body: never) => unknown>(
  _status: TStatus,
  code: 404 | 409 | 503,
  errorBody: MNetServiceError
): never {
  return _status(code as Parameters<TStatus>[0], { error: errorBody } as Parameters<TStatus>[1]) as never
}

/**
 * M-Net 业务错误在内部 HTTP 面收敛成稳定状态码，方便 Core 继续沿用统一错误映射策略。
 */
function statusCodeForMNetError(code: string): 404 | 409 | 503 {
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
    case 'node.join_ticket_expired':
    case 'node.join_ticket_redeemed':
    case 'node.join_ticket_revoked':
      return 409
    default:
      return 503
  }
}

/**
 * M-Net internal HTTP 面承载 Core -> M-Net 的同步业务边界。
 * 这里显式保留内部鉴权、错误映射和最小 route schema，避免回退到私有对象或 NATS RPC。
 */
export function createMNetApp(deps: MNetAppDeps) {
  const internalResponse = <
    TSuccess extends ReturnType<typeof t.Object>,
    const TExtra extends Record<number, ReturnType<typeof t.Object>> = {}
  >(
    success: TSuccess,
    extra?: TExtra
  ) => ({
    200: success,
    401: internalErrorSchema,
    ...(extra ?? {})
  }) as const

  return new Elysia()
    .get('/health', () => ({ ok: true as const, service: 'm-net' as const }))
    // ready 路由只接受内部调用；它同时验证 PostgreSQL、M-EventBus 和 M-Log 依赖是否可用。
    .get('/ready', async ({ headers, status }) => {
      const unauthorized = requireInternal(headers, status)
      if (unauthorized) return unauthorized
      return withExtractedSpan('m-net', 'm-net.ready', headers, () => deps.readiness())
    })
    // 这一组 internal routes 是 Core -> M-Net 的显式同步业务边界：
    // 网络编排与 agent task execute 都必须经由这里，而不是继续使用 NATS RPC。
    .group('/internal/v0', (app) => app
      .post('/networks', async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.create', headers, async () => {
          const result = await deps.createNetwork(body)
          return result.ok
            ? { network: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          profileVersion: t.Optional(t.String({ minLength: 1 }))
        }),
        response: internalResponse(t.Object({ network: networkSchema }), {
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      .get('/networks', async ({ headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.list', headers, async () => {
          const result = await deps.listNetworks()
          return result.ok
            ? { networks: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        response: internalResponse(t.Object({ networks: t.Array(networkSummarySchema) }), {
          503: internalErrorSchema
        })
      })
      .post('/networks/:id/members', async ({ params, body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.join', headers, async () => {
          const result = await deps.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
          return result.ok
            ? { member: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        body: t.Object({
          nodeId: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ member: networkMemberSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      .get('/networks/:id/members', async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.members.list', headers, async () => {
          const result = await deps.listMembers({ networkId: params.id })
          return result.ok
            ? { members: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ members: t.Array(networkMemberSchema) }), {
          404: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      // Core 对 agent noop 的同步调用收敛到 loopback HTTP；M-Net 再通过活动 session 下发 task.execute。
      .post('/tasks/noop', async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.task.execute.noop', headers, async () => {
          const result = await deps.executeNoop(body)
          return result.ok
            ? { result: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        body: t.Object({
          nodeId: t.String({ minLength: 1 }),
          taskId: t.String({ minLength: 1 }),
          correlationId: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ result: taskExecuteResponseSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }))
}

export type MNetApp = ReturnType<typeof createMNetApp>
