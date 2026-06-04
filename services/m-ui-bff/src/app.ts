import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId, Permission, CoreMode, CoreDependencies, MNode,
  ServiceSummary, TimelineLog, MinimalPolicyDecisionSummary,
  AuditLog, PolicyDecision, CommandWellEligibility
} from '../../../packages/contracts/src/index.ts'
import { deriveNoopCommandEligibility, missingPermissionCommandEligibility, targetMissingCommandEligibility } from './command-well/eligibility.ts'
import { SDUI_V02_ROUTE_REGISTRY } from './routes/route-registry.ts'

type StateSourceMetadata = {
  sourceType: 'authoritative' | 'event' | 'cache' | 'read-model' | 'log' | 'audit' | 'policy'
  sourceId: string
  correlationId?: string
  traceId?: string
}

type GenericNoopEligibility =
  | {
      state: 'enabled'
      command: {
        id: 'task.noop.submit'
        label: string
        action: Permission
        resource: string
        risk: 'medium'
        requiredPermissions: readonly Permission[]
        requiresPolicy: boolean
        requiresAudit: boolean
      }
    }
  | Extract<CommandWellEligibility, { state: 'disabled' }>

const GENERIC_NOOP_COMMAND_ID = 'task.noop.submit'

export type MUiBffDeps = {
  coreBaseUrl: string
  taskBaseUrl?: string
}

/**
 * serviceFetch 是对上游 REST v0 的薄封装：自动注入 Bearer token、统一错误契约。
 * BFF 同时面向 Core 读模型和 M-Task 命令面。
 */
async function serviceFetch(
  baseUrl: string,
  path: string,
  token?: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const hasBody = init?.body !== undefined
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    })
    const data = await response.json()
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: { code: 'bff.service_unreachable', message: 'Upstream service unreachable' } } }
  }
}

/**
 * 从请求头里提取 Bearer token，兼容不同大小写拼写。
 */
function bearerTokenFromHeaders(headers: Record<string, string | undefined>): string | null {
  const auth = headers.authorization ?? headers.Authorization ?? headers['Authorization']
  return extractBearerToken(auth)
}

/** BFF 错误响应统一走 JSON + HTTP status，保留 Core 错误 envelope 透传能力。 */
function bffError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** 透传 Core 侧返回的错误，保留原始 HTTP 状态码与 error envelope。 */
function passthroughCoreError(result: { ok: boolean; status: number; data: unknown }): Response {
  return new Response(JSON.stringify(result.data), {
    status: result.status || 502,
    headers: { 'content-type': 'application/json' }
  })
}

/** 给展示数据附加状态来源，BFF 只标注来源，不成为事实源。 */
function withStateSource<T extends object>(value: T, stateSource: StateSourceMetadata): T & { stateSource: StateSourceMetadata } {
  return { ...value, stateSource }
}

/** 泛型 CommandWell 使用 SDUI v0.2 命令 ID，底层仍复用 noop 判定事实。 */
function toGenericNoopEligibility(eligibility: CommandWellEligibility): GenericNoopEligibility {
  if (eligibility.state === 'disabled') return eligibility
  return {
    state: 'enabled',
    command: {
      ...eligibility.command,
      id: GENERIC_NOOP_COMMAND_ID,
      requiredPermissions: [...eligibility.command.requiredPermissions]
    }
  }
}

/**
 * createMUiBffApp 构建 M-UI 的 BFF Elysia 应用。
 * BFF 是面向 SvelteKit shell 的公开入口，不参与内部 loopback 认证。
 * 它负责聚合 Core REST v0 数据、派生命令可用状态并透传任务执行请求。
 */
export function createMUiBffApp(deps: MUiBffDeps) {
  const cf = (path: string, token?: string, init?: RequestInit) => serviceFetch(deps.coreBaseUrl, path, token, init)
  const tf = (path: string, token?: string, init?: RequestInit) => serviceFetch(deps.taskBaseUrl ?? deps.coreBaseUrl, path, token, init)

  return new Elysia()
    .use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["content-type", "authorization"], credentials: true })) // 开发环境允许任意 origin；生产部署需替换为具体允许域名
    .use(openapi({
      path: '/openapi-ui',
      specPath: '/openapi',
      provider: null,
      documentation: {
        info: { title: 'Meristem M-UI BFF API', version: 'v0' }
      }
    }))
    .get('/health', () => ({ ok: true as const, service: 'm-ui-bff' as const }))
    .get('/ready', async () => {
      const result = await cf('/api/v0/health', undefined)
      return { ready: result.ok }
    })

    // route registry：先通过 Core session 验证 Bearer token，再发布本 BFF 的 SDUI v0.2 展示契约。
    .get('/api/v0/routes', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const sessionRes = await cf('/api/v0/session', token)
      if (!sessionRes.ok) return passthroughCoreError(sessionRes)
      return SDUI_V02_ROUTE_REGISTRY
    }, {
      detail: { summary: 'Read SDUI v0.2 route registry' }
    })
    // route lookup：只返回已注册的 SDUI v0.2 route，未知 id 按 BFF 合同返回 404。
    .get('/api/v0/routes/:id', async ({ params, headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const sessionRes = await cf('/api/v0/session', token)
      if (!sessionRes.ok) return passthroughCoreError(sessionRes)

      const route = SDUI_V02_ROUTE_REGISTRY.routes.find((candidate) => candidate.id === params.id)
      if (!route) return bffError(404, 'route.not_found', 'route not found')
      return { route }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { summary: 'Read one SDUI v0.2 route definition' }
    })

    // nodes display：转发 Core 权威节点列表，并为 UI 增加状态来源标注。
    .get('/api/v0/nodes', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf('/api/v0/nodes', token)
      if (!result.ok) return passthroughCoreError(result)
      const nodes = (result.data as { nodes: MNode[] }).nodes.map((node) =>
        withStateSource(node, { sourceType: 'authoritative', sourceId: `core:/api/v0/nodes/${node.id}` })
      )
      return {
        nodes,
        stateSource: { sourceType: 'authoritative', sourceId: 'core:/api/v0/nodes' } satisfies StateSourceMetadata
      }
    }, {
      detail: { summary: 'Read display-shaped node list' }
    })

    // timeline display：Timeline 事实来自 Core/M-Log，BFF 只补充 display source。
    .get('/api/v0/timeline', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf('/api/v0/logs/timeline', token)
      if (!result.ok) return passthroughCoreError(result)
      const entries = (result.data as { entries: TimelineLog[] }).entries.map((entry) =>
        withStateSource(entry, {
          sourceType: 'log',
          sourceId: `core:/api/v0/logs/timeline/${entry.id}`,
          ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
        })
      )
      return {
        entries,
        stateSource: { sourceType: 'log', sourceId: 'core:/api/v0/logs/timeline' } satisfies StateSourceMetadata
      }
    }, {
      detail: { summary: 'Read display-shaped timeline entries' }
    })

    // audit display：Core 继续执行 audit:read，BFF 透传拒绝并只标注允许读取的审计事实来源。
    .get('/api/v0/audit', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf('/api/v0/audit', token)
      if (!result.ok) return passthroughCoreError(result)
      const entries = (result.data as { entries: AuditLog[] }).entries.map((entry) =>
        withStateSource(entry, {
          sourceType: 'audit',
          sourceId: `core:/api/v0/audit/${entry.id}`,
          ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
        })
      )
      return {
        entries,
        stateSource: { sourceType: 'audit', sourceId: 'core:/api/v0/audit' } satisfies StateSourceMetadata
      }
    }, {
      detail: { summary: 'Read display-shaped audit entries' }
    })

    // policy decisions display：优先走 Core 列表端点；旧 Core 尚未提供时返回空列表但保留 policy 来源。
    .get('/api/v0/policy/decisions', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf('/api/v0/policy/decisions', token)
      if (!result.ok && result.status !== 404) return passthroughCoreError(result)
      const decisions = result.ok
        ? (result.data as { decisions: PolicyDecision[] }).decisions.map((decision) =>
            withStateSource(decision, { sourceType: 'policy', sourceId: `core:/api/v0/policy/decisions/${decision.id}` })
          )
        : []
      return {
        decisions,
        stateSource: { sourceType: 'policy', sourceId: 'core:/api/v0/policy/decisions' } satisfies StateSourceMetadata
      }
    }, {
      detail: { summary: 'Read display-shaped policy decision list' }
    })

    // services display：转发 Core 服务生命周期摘要，保留 Core 作为权威来源。
    .get('/api/v0/services', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf('/api/v0/services', token)
      if (!result.ok) return passthroughCoreError(result)
      const services = (result.data as { services: ServiceSummary[] }).services.map((service) =>
        withStateSource(service, { sourceType: 'authoritative', sourceId: `core:/api/v0/services/${service.id}` })
      )
      return {
        services,
        stateSource: { sourceType: 'authoritative', sourceId: 'core:/api/v0/services' } satisfies StateSourceMetadata
      }
    }, {
      detail: { summary: 'Read display-shaped service list' }
    })

    // overview 聚合控制台主页面数据：会话、状态、节点、服务、时间线、审计（按权限）。
    // 生命周期：先并行拉取非审计数据，再按权限条件拉取审计日志。
    .get('/api/v0/overview', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const [sessionRes, statusRes, nodesRes, servicesRes, timelineRes] = await Promise.all([
        cf('/api/v0/session', token),
        cf('/api/v0/status', token),
        cf('/api/v0/nodes', token),
        cf('/api/v0/services', token),
        cf('/api/v0/logs/timeline', token)
      ])

      if (!sessionRes.ok) return passthroughCoreError(sessionRes)
      if (!statusRes.ok) return passthroughCoreError(statusRes)

      const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }
      const status = statusRes.data as { core: { id: string; version: string; mode: CoreMode }; dependencies: CoreDependencies; counts: { services: number; nodes: number; tasks: number } }
      const nodes = nodesRes.ok ? (nodesRes.data as { nodes: MNode[] }).nodes : []
      const services = servicesRes.ok ? (servicesRes.data as { services: ServiceSummary[] }).services : []
      const timeline = timelineRes.ok ? (timelineRes.data as { entries: TimelineLog[] }).entries : []

      const auditAccessible = session.permissions.includes('audit:read') as boolean

      // 如果当前会话有 audit:read 权限，拉取审计日志；失败时置 null 不阻塞 overview
      let auditEntries = null
      if (auditAccessible) {
        const auditRes = await cf('/api/v0/audit', token)
        auditEntries = auditRes.ok ? (auditRes.data as { entries: unknown[] }).entries : null
      }

      return {
        session,
        core: status.core,
        dependencies: status.dependencies,
        nodes,
        services,
        timeline,
        auditAccessible,
        audit: auditEntries,
        stateSources: {
          session: 'authoritative' as const,
          core: 'authoritative' as const,
          dependencies: 'authoritative' as const,
          nodes: 'authoritative' as const,
          services: 'authoritative' as const,
          timeline: 'log' as const,
          audit: 'audit' as const
        }
      }
    })
    .get('/api/v0/nodes/:id', async ({ params, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 调用 Core 节点详情端点
      const result = await cf(`/api/v0/nodes/${params.id}`, token)
      if (!result.ok) return passthroughCoreError(result)
      return { ...(result.data as Record<string, unknown>), stateSource: { sourceType: 'authoritative', sourceId: `core:/api/v0/nodes/${params.id}` } }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { summary: 'Read single node detail' }
    })

    // policy decision summary：从 Core 读取完整决策后裁剪掉 reasons 等内部字段，仅返回 BFF 层汇总视图。
    // 鉴权与错误映射：token 缺失 → 401，Core 错误 → 透传。
    .get('/api/v0/policy/decisions/:id/summary', async ({ params, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 调用 Core policy decisions 端点获取完整决策
      const result = await cf(`/api/v0/policy/decisions/${params.id}`, token)
      if (!result.ok) return passthroughCoreError(result)

      // 裁剪：从完整 PolicyDecision 中只取 id / actor / action / resource / result / createdAt，去除 reasons 等内部字段
      const full = (result.data as { decision: MinimalPolicyDecisionSummary }).decision
      const decision: MinimalPolicyDecisionSummary = {
        id: full.id,
        actor: full.actor,
        action: full.action,
        resource: full.resource,
        result: full.result,
        createdAt: full.createdAt
      }

      return { decision }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { summary: 'Read policy decision summary (reasons redacted)' }
    })
    // 完整策略决策详情，带 stateSource 标注，供 policy.decisions 路由使用。
    .get('/api/v0/policy/decisions/:id', async ({ params, headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await cf(`/api/v0/policy/decisions/${params.id}`, token)
      if (!result.ok) return passthroughCoreError(result)
      return withStateSource((result.data as { decision: MinimalPolicyDecisionSummary }).decision, {
        sourceType: 'policy', sourceId: `core:/api/v0/policy/decisions/${params.id}`
      })
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { summary: 'Read full policy decision with state source' }
    })

    // noop 命令状态派生：检查权限、节点类型和可达性，不执行实际操作。
    .post('/api/v0/commands/noop', async ({ body, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 策略：并行获取会话与目标节点信息
      const [sessionRes, nodeRes] = await Promise.all([
        cf('/api/v0/session', token),
        cf(`/api/v0/nodes/${body.leafNodeId}`, token)
      ])

      if (!sessionRes.ok) return passthroughCoreError(sessionRes)
      const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }

      if (!session.permissions.includes('task:submit')) {
        return missingPermissionCommandEligibility()
      }

      if (!nodeRes.ok) {
        if (nodeRes.status === 404) return targetMissingCommandEligibility()
        return passthroughCoreError(nodeRes)
      }
      const node = (nodeRes.data as { node: MNode }).node
      return deriveNoopCommandEligibility(session, node)
    }, {
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Derive disabled/enabled state for the noop task command' }
    })
    // noop 执行：透传到 canonical M-Task POST /api/v0/tasks。
    .post('/api/v0/commands/noop/execute', async ({ body, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 日志：透传任务执行请求到 M-Task，错误由任务服务按策略和日志契约处理。
      const result = await tf('/api/v0/tasks', token, {
        method: 'POST',
        body: JSON.stringify({ nodeId: body.leafNodeId, type: 'noop' })
      })
      if (!result.ok) return passthroughCoreError(result)
      return result.data
    }, {
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Execute noop task against a Leaf node' }
    })
    // 泛型命令可用性：只接受 BFF 明确声明的命令 ID，避免任意后端路径转发。
    .post('/api/v0/commands/:commandId/eligibility', async ({ params, body, headers }) => {
      if (params.commandId !== GENERIC_NOOP_COMMAND_ID) {
        return bffError(400, 'command.unknown', 'unknown command id')
      }

      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const [sessionRes, nodeRes] = await Promise.all([
        cf('/api/v0/session', token),
        cf(`/api/v0/nodes/${body.leafNodeId}`, token)
      ])

      if (!sessionRes.ok) return passthroughCoreError(sessionRes)
      const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }

      if (!session.permissions.includes('task:submit')) {
        return toGenericNoopEligibility(missingPermissionCommandEligibility())
      }

      if (!nodeRes.ok) {
        if (nodeRes.status === 404) return toGenericNoopEligibility(targetMissingCommandEligibility())
        return passthroughCoreError(nodeRes)
      }

      const node = (nodeRes.data as { node: MNode }).node
      return toGenericNoopEligibility(deriveNoopCommandEligibility(session, node))
    }, {
      params: t.Object({ commandId: t.String({ minLength: 1 }) }),
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Derive generic CommandWell eligibility' }
    })
    // 泛型命令执行：只把 task.noop.submit 映射到 M-Task noop，不做开放式代理。
    .post('/api/v0/commands/:commandId/execute', async ({ params, body, headers }) => {
      if (params.commandId !== GENERIC_NOOP_COMMAND_ID) {
        return bffError(400, 'command.unknown', 'unknown command id')
      }

      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const result = await tf('/api/v0/tasks', token, {
        method: 'POST',
        body: JSON.stringify({ nodeId: body.leafNodeId, type: 'noop' })
      })
      if (!result.ok) return passthroughCoreError(result)
      return result.data
    }, {
      params: t.Object({ commandId: t.String({ minLength: 1 }) }),
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Execute generic CommandWell command' }
    })
}

export type MUiBffApp = ReturnType<typeof createMUiBffApp>
