import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId, Permission, CoreMode, CoreDependencies, MNode,
  ServiceSummary, TimelineLog, CommandWellEligibility, DisabledCommandExplanation, MinimalPolicyDecisionSummary
} from '../../../packages/contracts/src/index.ts'

export type MUiBffDeps = {
  coreBaseUrl: string
}

/**
 * coreFetch 是对 Core REST v0 的薄封装：自动注入 Bearer token、统一错误契约。
 * 可选的 init 参数支持非 GET 请求（如 POST /api/v0/tasks）。
 */
async function coreFetch(
  deps: MUiBffDeps,
  path: string,
  token?: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const hasBody = init?.body !== undefined
    const response = await fetch(`${deps.coreBaseUrl}${path}`, {
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
    return { ok: false, status: 0, data: { error: { code: 'bff.core_unreachable', message: 'Core unreachable' } } }
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

function disabledCommand(code: DisabledCommandExplanation['code'], message: string, missingPermission?: Permission): CommandWellEligibility {
  const disabled: DisabledCommandExplanation = {
    code,
    message,
    ...(missingPermission ? { missingPermission } : {})
  }
  return { state: 'disabled', disabled, disabledReason: message }
}

/**
 * CommandWell eligibility is display-only and derived from Core-visible session and node facts.
 * Source: docs/plans/2026-05-23-effect-projection-hardening.md §3 Slice 4
 */
function deriveNoopCommandEligibility(session: { permissions: Permission[] }, node: MNode): CommandWellEligibility {
  if (node.kind !== 'leaf') {
    return disabledCommand('wrong_node_kind', '目标不是 Leaf 节点')
  }
  if (node.reachability !== 'reachable') {
    return disabledCommand('node_unreachable', '目标节点不可达')
  }

  return {
    state: 'enabled',
    command: {
      id: 'task.noop.run',
      label: '运行 noop 任务',
      action: 'task:assign',
      resource: node.id,
      risk: 'medium',
      requiredPermissions: ['task:assign'],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/**
 * createMUiBffApp 构建 M-UI 的 BFF Elysia 应用。
 * BFF 是面向 SvelteKit shell 的公开入口，不参与内部 loopback 认证。
 * 它负责聚合 Core REST v0 数据、派生命令可用状态并透传任务执行请求。
 */
export function createMUiBffApp(deps: MUiBffDeps) {
  const cf = (path: string, token?: string, init?: RequestInit) => coreFetch(deps, path, token, init)

  return new Elysia()
    .use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["content-type", "authorization"], credentials: true }))
    .use(openapi({
      documentation: {
        info: { title: 'Meristem M-UI BFF API', version: 'v0' }
      }
    }))
    .get('/health', () => ({ ok: true as const, service: 'm-ui-bff' as const }))
    .get('/ready', async () => {
      const result = await cf('/api/v0/health', undefined)
      return { ready: result.ok }
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
        audit: auditEntries
      }
    })
    .get('/api/v0/nodes/:id', async ({ params, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 调用 Core 节点详情端点
      const result = await cf(`/api/v0/nodes/${params.id}`, token)
      if (!result.ok) return passthroughCoreError(result)
      return result.data
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

      if (!session.permissions.includes('task:assign')) {
        return disabledCommand('missing_permission', '缺少权限：task:assign', 'task:assign')
      }

      if (!nodeRes.ok) return passthroughCoreError(nodeRes)
      const node = (nodeRes.data as { node: MNode }).node
      return deriveNoopCommandEligibility(session, node)
    }, {
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Derive disabled/enabled state for the noop task command' }
    })
    // noop 执行：透传任务到 Core POST /api/v0/tasks。
    .post('/api/v0/commands/noop/execute', async ({ body, headers }) => {
      // 鉴权：提取 Bearer token
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 日志：透传任务执行请求到 Core，错误由 Core 感知并记录
      const result = await cf('/api/v0/tasks', token, {
        method: 'POST',
        body: JSON.stringify({ leafNodeId: body.leafNodeId, type: 'noop' })
      })
      if (!result.ok) return passthroughCoreError(result)
      return result.data
    }, {
      body: t.Object({ leafNodeId: t.String({ minLength: 1 }) }),
      detail: { summary: 'Execute noop task against a Leaf node' }
    })
}

export type MUiBffApp = ReturnType<typeof createMUiBffApp>
