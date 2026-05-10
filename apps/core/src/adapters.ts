import { edenTreaty } from '@elysiajs/eden'
import { and, eq } from 'drizzle-orm'
import { err, ok } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  AssignTaskRequest,
  CreateNodeTicketRequest,
  CreateNetworkRequest,
  AuditLog,
  CoreDependencies,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NodeAgentTaskExecuteResponse,
  NetworkSummary,
  MTask,
  PolicyDecision,
  RegisterNodeRequest,
  ServiceSummary,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import { createDb, type MeristemDb } from '../../../packages/db/src/client.ts'
import { nodeCredentials, nodeJoinTickets, nodes, serviceDefinitions, tasks } from '../../../packages/db/src/schema.ts'
import { createInternalFetcher as createInternalHttpFetcher, fetchReadyState, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { connectToNats, subjects, type RpcClient } from '../../../packages/nats-rpc/src/index.ts'
import { extractBearerToken, hashNodeToken, mintNodeToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import type { EventBusApp } from '../../../services/m-eventbus/src/app.ts'
import type { LogApp } from '../../../services/m-log/src/app.ts'
import type { MNetApp } from '../../../services/m-net/src/app.ts'
import type { PolicyApp } from '../../../services/m-policy/src/app.ts'
import type { CoreDeps, CoreStorage } from './types.ts'

// Core adapters 负责把 HTTP、NATS、数据库和内部服务客户端折叠成微内核可消费的稳定端口。
type ServiceResponse<T> = { ok: true; decision?: PolicyDecision; entry?: T; entries?: T[]; eventId?: string }

/**
 * JWT 密钥缺失直接阻断进程启动，避免 Core 在无认证边界的状态下对外提供写接口。
 */
function requiredSecret(): string {
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
  return secret
}

/**
 * Auth 端口只包装本地 JWT 验证器，不在这里追加角色推导或数据库查询。
 */
export function createJwtAuthPort(secret = requiredSecret()) {
  return {
    async verify(token: string) {
      return verifyLocalToken({ token, secret })
    }
  }
}

/**
 * 旧版策略 RPC 端口仍然保留给兼容路径使用；它只做请求/错误收敛，不在适配层重写授权语义。
 */
export function createRpcPolicyPort(rpc: RpcClient) {
  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      try {
        const response = await rpc.request<typeof input, { ok: true; decision: PolicyDecision }>(
          subjects.policyAuthorize,
          input
        )
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    },
    async getDecision(id: string) {
      try {
        const response = await rpc.request<{ id: string }, { ok: true; decision: PolicyDecision | null }>(
          subjects.policyDecisionGet,
          { id }
        )
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    }
  }
}

/**
 * 旧版日志 RPC 端口只负责把三类日志与查询请求转给 M-Log，并统一收敛不可用错误。
 */
export function createRpcLogPort(rpc: RpcClient) {
  return {
    async writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<TimelineLog>>(subjects.timelineWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeFull(input: Omit<FullLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<FullLog>>(subjects.fullWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<AuditLog>>(subjects.auditWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    },
    async listTimeline(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<TimelineLog>>(
          subjects.timelineList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listFull(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<FullLog>>(
          subjects.fullList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listAudit(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<AuditLog>>(
          subjects.auditList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    }
  }
}

/**
 * 事件发布 RPC 端口保持最小封装，避免 Core 直接依赖底层 subject 和响应细节。
 */
export function createRpcEventPort(rpc: RpcClient) {
  return {
    async publish(subject: string, event: Parameters<CoreDeps['events']['publish']>[1]) {
      try {
        const response = await rpc.request<{ subject: string; event: typeof event }, { ok: boolean; eventId?: string }>(
          subjects.eventPublish,
          { subject, event }
        )
        return response.ok && response.eventId
          ? ok({ eventId: response.eventId })
          : err({ code: 'eventbus.rejected', message: 'event rejected by M-EventBus' })
      } catch {
        return err({ code: 'eventbus.unavailable', message: 'M-EventBus unavailable' })
      }
    }
  }
}

type MNetServiceResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

type BuiltinServiceDefinition = Pick<ServiceSummary, 'id' | 'version' | 'domain' | 'kind' | 'lifecycle'>
type DynamicServiceRow = {
  id: string
  version: string
  domain: string
  kind: string
}

// 这组内建服务是 MVP 运行态聚合的固定骨架，动态服务定义只会在此基础上补充。
const builtinServices: BuiltinServiceDefinition[] = [
  {
    id: 'meristem-core',
    version: '0.1.0',
    domain: 'core',
    kind: 'core',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-policy',
    version: '0.1.0',
    domain: 'm-policy',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-log',
    version: '0.1.0',
    domain: 'm-log',
    kind: 'internal',
    lifecycle: { reloadable: true, rollbackable: false, degradable: true }
  },
  {
    id: 'm-eventbus',
    version: '0.1.0',
    domain: 'm-eventbus',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-net',
    version: '0.1.0',
    domain: 'm-net',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  }
]

function createInternalFetcher() {
  return createInternalHttpFetcher()
}

function createJoinTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `mjt_${suffix}`
}

/**
 * Eden 客户端失败时优先尝试解包统一错误体，保证 Core 侧错误文案
 * 不依赖某个服务的偶然字符串实现。
 */
function errorMessageFromHttpResponse(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback
  const maybeError = Reflect.get(value, 'error')
  if (typeof maybeError !== 'object' || maybeError === null) return fallback
  const message = Reflect.get(maybeError, 'message')
  return typeof message === 'string' ? message : fallback
}

function serviceErrorFromHttpResponse(value: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (typeof value !== 'object' || value === null) {
    return { code: fallbackCode, message: fallbackMessage }
  }
  const maybeError = Reflect.get(value, 'error')
  if (typeof maybeError !== 'object' || maybeError === null) {
    return { code: fallbackCode, message: fallbackMessage }
  }
  const code = Reflect.get(maybeError, 'code')
  const message = Reflect.get(maybeError, 'message')
  return {
    code: typeof code === 'string' ? code : fallbackCode,
    message: typeof message === 'string' ? message : fallbackMessage
  }
}

/**
 * Core 到 M-Policy 的同步调用已经收敛到 loopback HTTP + Eden。
 * 这里统一把内部服务错误折叠成 Core 可消费的 Result 形状。
 */
function createHttpPolicyPort() {
  const client = edenTreaty<PolicyApp>(serviceUrl('m-policy'), { fetcher: createInternalFetcher() })

  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      try {
        const response = await client.internal.v0.authorize.post(input)
        if (response.error || !response.data) {
          return err({
            code: 'policy.unavailable',
            message: errorMessageFromHttpResponse(response.error?.value, 'M-Policy unavailable')
          })
        }
        return ok(response.data.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    },
    async getDecision(id: string) {
      try {
        const routes = client.internal.v0.decisions as Record<
          string,
          { get(params: {}): Promise<{ data: unknown | null; error: { value: unknown; status: number } | null; status: number }> }
        >
        const route = routes[id]
        if (!route) return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
        const response = await route.get({})
        if (response.error) {
          if (response.status === 404) return ok(null)
          return err({
            code: 'policy.unavailable',
            message: errorMessageFromHttpResponse(response.error.value, 'M-Policy unavailable')
          })
        }
        return ok((response.data ?? null) as PolicyDecision | null)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    }
  }
}

/**
 * M-Log 仍然由 Core 编排审计与时间线写入，因此这里需要把内部 HTTP 契约
 * 包装成稳定的日志端口，而不是把 Elysia/Eden 细节泄漏给上层路由。
 */
function createHttpLogPort() {
  const client = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher: createInternalFetcher() })

  return {
    async writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>) {
      try {
        const response = await client.internal.v0.timeline.post(input)
        return response.error || !response.data
          ? err({ code: 'log.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'M-Log unavailable') })
          : ok(response.data.entry)
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeFull(input: Omit<FullLog, 'id' | 'timestamp'>) {
      try {
        const response = await client.internal.v0.full.post(input)
        return response.error || !response.data
          ? err({ code: 'log.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'M-Log unavailable') })
          : ok(response.data.entry)
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>) {
      try {
        const response = await client.internal.v0.audit.post(input)
        return response.error || !response.data
          ? err({ code: 'audit.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'Audit Log unavailable') })
          : ok(response.data.entry)
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    },
    async listTimeline(limit?: number) {
      try {
        const response = await client.internal.v0.timeline.get({ $query: limit === undefined ? {} : { limit } })
        return response.error || !response.data
          ? err({ code: 'log.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'M-Log unavailable') })
          : ok(response.data.entries)
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listFull(limit?: number) {
      try {
        const response = await client.internal.v0.full.get({ $query: limit === undefined ? {} : { limit } })
        return response.error || !response.data
          ? err({ code: 'log.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'M-Log unavailable') })
          : ok(response.data.entries)
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listAudit(limit?: number) {
      try {
        const response = await client.internal.v0.audit.get({ $query: limit === undefined ? {} : { limit } })
        return response.error || !response.data
          ? err({ code: 'audit.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'Audit Log unavailable') })
          : ok(response.data.entries)
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    }
  }
}

/**
 * EventBus 适配器只负责同步发布确认；事件真正的异步传播仍然留在下游总线处理。
 */
function createHttpEventPort() {
  const client = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), { fetcher: createInternalFetcher() })

  return {
    async publish(subject: string, event: Parameters<CoreDeps['events']['publish']>[1]) {
      try {
        const response = await client.internal.v0.publish.post({ subject, event })
        return response.error || !response.data
          ? err({ code: 'eventbus.unavailable', message: errorMessageFromHttpResponse(response.error?.value, 'M-EventBus unavailable') })
          : ok({ eventId: response.data.eventId })
      } catch {
        return err({ code: 'eventbus.unavailable', message: 'M-EventBus unavailable' })
      }
    }
  }
}

async function dependencyStateFromReady(url: string): Promise<'ready' | 'unavailable'> {
  return (await fetchReadyState(url)) ? 'ready' : 'unavailable'
}

/**
 * health 探测只判断进程是否响应，不把 ready 语义混到这里。
 */
async function fetchHealthState(url: string): Promise<boolean> {
  try {
    const response = await createInternalFetcher()(url, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

function isServiceDomain(value: string): value is ServiceSummary['domain'] {
  return value === 'core'
    || value === 'm-net'
    || value === 'm-eventbus'
    || value === 'm-log'
    || value === 'm-policy'
    || value === 'm-ui'
    || value === 'm-cli'
    || value === 'm-extension'
}

function isServiceKind(value: string): value is ServiceSummary['kind'] {
  return value === 'core'
    || value === 'internal'
    || value === 'node'
    || value === 'task'
    || value === 'extension'
    || value === 'bff'
}

function normalizeDynamicServiceRow(row: unknown): DynamicServiceRow | null {
  if (typeof row !== 'object' || row === null) return null
  const id = Reflect.get(row, 'id')
  const version = Reflect.get(row, 'version')
  const domain = Reflect.get(row, 'domain')
  const kind = Reflect.get(row, 'kind')
  return typeof id === 'string'
    && typeof version === 'string'
    && typeof domain === 'string'
    && typeof kind === 'string'
    ? { id, version, domain, kind }
    : null
}

/**
 * Core 运行态由 required dependencies 聚合而来；任何一个依赖掉线都让 Core 进入 degraded。
 */
function coreRuntimeFromDependencies(dependencies: CoreDependencies): NonNullable<ServiceSummary['runtime']> {
  const dependencyStates = Object.values(dependencies)
  const ready = dependencyStates.every((state) => state === 'ready')
  return ready
    ? { liveness: true, readiness: true, mode: 'normal' }
    : {
        liveness: true,
        readiness: false,
        mode: 'degraded',
        lastError: 'one or more required dependencies are unavailable'
      }
}

/**
 * 内部服务运行态一律通过 /health + /ready 实时探测，而不是缓存某次启动时的结论。
 */
async function runtimeFromInternalReadiness(
  name: 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'
): Promise<NonNullable<ServiceSummary['runtime']>> {
  const [liveness, readiness] = await Promise.all([
    fetchHealthState(`${serviceUrl(name)}/health`),
    fetchReadyState(`${serviceUrl(name)}/ready`)
  ])
  return readiness
    ? { liveness, readiness: true, mode: 'normal' }
    : {
        liveness,
        readiness: false,
        mode: 'degraded',
        lastError: 'service is not ready'
      }
}

function dynamicServiceSummary(row: DynamicServiceRow): ServiceSummary | null {
  if (!isServiceDomain(row.domain) || !isServiceKind(row.kind)) return null
  return {
    id: row.id,
    version: row.version,
    domain: row.domain,
    kind: row.kind,
    lifecycle: { reloadable: false, rollbackable: false, degradable: true },
    runtime: {
      liveness: false,
      readiness: false,
      mode: 'degraded',
      lastError: 'runtime state is not exposed for this service definition'
    }
  }
}

function createServiceLifecyclePort(storage: CoreStorage, readinessChecks: () => Promise<CoreDependencies>) {
  const client = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher: createInternalFetcher() })
  const lifecycleRoutes = client.internal.v0.lifecycle as {
    reload: {
      post(input: { correlationId?: string; reason?: string }): Promise<{
        data: { ok: true; serviceId: string; reloadedAt: string } | null
        error: { value: unknown; status: number } | null
        status: number
      }>
    }
  }

  return {
    async list() {
      try {
        // service list 既展示静态定义，也补齐当前实时运行态，供 CLI 和后续 UI 直接消费。
        const [dependencies, rows, policyRuntime, logRuntime, eventBusRuntime, mNetRuntime] = await Promise.all([
          readinessChecks(),
          storage.listServices(),
          runtimeFromInternalReadiness('m-policy'),
          runtimeFromInternalReadiness('m-log'),
          runtimeFromInternalReadiness('m-eventbus'),
          runtimeFromInternalReadiness('m-net')
        ])
        const builtinRuntimeById = new Map<string, ServiceSummary>(
          builtinServices.map((service) => {
            if (service.id === 'meristem-core') return [service.id, { ...service, runtime: coreRuntimeFromDependencies(dependencies) }]
            if (service.id === 'm-policy') return [service.id, { ...service, runtime: policyRuntime }]
            if (service.id === 'm-log') return [service.id, { ...service, runtime: logRuntime }]
            if (service.id === 'm-eventbus') return [service.id, { ...service, runtime: eventBusRuntime }]
            return [service.id, { ...service, runtime: mNetRuntime }]
          })
        )
        const dynamicServices = rows
          .map(normalizeDynamicServiceRow)
          .flatMap((row) => row ? [row] : [])
          .filter((row) => !builtinRuntimeById.has(row.id))
          .map(dynamicServiceSummary)
          .flatMap((service) => service ? [service] : [])
        return ok([...builtinRuntimeById.values(), ...dynamicServices])
      } catch {
        return err({ code: 'service.unavailable', message: 'service lifecycle unavailable' })
      }
    },
    async reload(input: { serviceId: string; correlationId: string; reason?: string }) {
      // 当前只有 m-log 具备 reload 原型，其它服务要么不可 reload，要么尚未暴露该能力。
      const builtinService = builtinServices.find((service) => service.id === input.serviceId)
      if (builtinService && !builtinService.lifecycle.reloadable) {
        return err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
      }

      if (builtinService?.id === 'm-log') {
        try {
          const response = await lifecycleRoutes.reload.post({
            correlationId: input.correlationId,
            ...(input.reason ? { reason: input.reason } : {})
          })
          if (response.error || !response.data) {
            return err({
              code: 'service.unavailable',
              message: errorMessageFromHttpResponse(response.error?.value, 'service reload failed')
            })
          }
          return ok({
            serviceId: response.data.serviceId,
            reloadedAt: response.data.reloadedAt
          })
        } catch {
          return err({ code: 'service.unavailable', message: 'service reload failed' })
        }
      }

      try {
        const serviceExists = (await storage.listServices())
          .map(normalizeDynamicServiceRow)
          .some((row) => row?.id === input.serviceId)
        return serviceExists
          ? err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
          : err({ code: 'service.not_found', message: 'service not found' })
      } catch {
        return err({ code: 'service.unavailable', message: 'service lifecycle unavailable' })
      }
    }
  }
}

/**
 * Core 到 M-Net 的同步网络调用改走 loopback HTTP + Eden，避免继续把业务边界压在 NATS RPC 上。
 */
export function createHttpMNetPort() {
  const client = edenTreaty<MNetApp>(serviceUrl('m-net'), { fetcher: createInternalFetcher() })
  const networkRoutes = client.internal.v0.networks as Record<
    string,
    {
      members: {
        post(params: { nodeId: string }): Promise<{ data: { member: MNetworkMember } | null; error: { value: unknown; status: number } | null; status: number }>
        get(params: {}): Promise<{ data: { members: MNetworkMember[] } | null; error: { value: unknown; status: number } | null; status: number }>
      }
    }
  >

  return {
    async createNetwork(input: CreateNetworkRequest) {
      try {
        const response = await client.internal.v0.networks.post(input)
        if (response.error || !response.data) {
          return err(serviceErrorFromHttpResponse(response.error?.value, 'mnet.unavailable', 'M-Net unavailable'))
        }
        return ok((response.data as { network: MNetwork }).network)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async listNetworks() {
      try {
        const response = await client.internal.v0.networks.get({})
        if (response.error || !response.data) {
          return err(serviceErrorFromHttpResponse(response.error?.value, 'mnet.unavailable', 'M-Net unavailable'))
        }
        return ok((response.data as { networks: NetworkSummary[] }).networks)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async joinNetwork(input: { networkId: string; nodeId: string }) {
      try {
        const route = networkRoutes[input.networkId]
        if (!route) return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        const response = await route.members.post({ nodeId: input.nodeId })
        if (response.error || !response.data) {
          return err(serviceErrorFromHttpResponse(response.error?.value, 'mnet.unavailable', 'M-Net unavailable'))
        }
        return ok((response.data as { member: MNetworkMember }).member)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async listNetworkMembers(networkId: string) {
      try {
        const route = networkRoutes[networkId]
        if (!route) return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        const response = await route.members.get({})
        if (response.error || !response.data) {
          return err(serviceErrorFromHttpResponse(response.error?.value, 'mnet.unavailable', 'M-Net unavailable'))
        }
        return ok((response.data as { members: MNetworkMember[] }).members)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    }
  }
}

/**
 * agent noop 下发改走 M-Net internal HTTP，由 M-Net 负责把 task.execute 投递给活动 session 并等待结果。
 */
export function createHttpAgentTaskPort() {
  const client = edenTreaty<MNetApp>(serviceUrl('m-net'), { fetcher: createInternalFetcher() })

  return {
    async executeNoop(input: { nodeId: string; taskId: string; correlationId: string }) {
      try {
        const response = await client.internal.v0.tasks.noop.post(input)
        if (response.error || !response.data) {
          return err(serviceErrorFromHttpResponse(response.error?.value, 'nodeagent.unavailable', 'node agent unavailable'))
        }
        return ok((response.data as { result: NodeAgentTaskExecuteResponse }).result)
      } catch {
        return err({ code: 'nodeagent.unavailable', message: 'node agent unavailable' })
      }
    }
  }
}

/**
 * createDbStorage 是 PostgreSQL 权威写模型适配器，所有节点、任务、凭据和服务元数据都在此落库。
 */
export function createDbStorage(db: MeristemDb, readinessChecks?: () => Promise<CoreDependencies>): CoreStorage {
  return {
    async readiness() {
      return readinessChecks ? readinessChecks() : {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': 'ready',
        'm-log': 'ready',
        'm-eventbus': 'ready',
        'm-net': 'ready'
      }
    },
    async counts() {
      const [serviceRows, nodeRows, taskRows] = await Promise.all([
        db.select().from(serviceDefinitions),
        db.select().from(nodes),
        db.select().from(tasks)
      ])
      return { services: serviceRows.length, nodes: nodeRows.length, tasks: taskRows.length }
    },
    async registerNode(input: RegisterNodeRequest) {
      const now = new Date()
      const id = crypto.randomUUID()
      const mode = 'simulated'
      await db.insert(nodes).values({
        id,
        kind: input.kind,
        name: input.name,
        mode,
        status: 'healthy',
        reachability: 'reachable',
        capabilities: input.capabilities ?? [],
        scope: input.kind === 'leaf' ? ['restricted-api', 'restricted-interconnect'] : [],
        createdAt: now,
        updatedAt: now
      })
      return {
        id,
        kind: input.kind,
        name: input.name,
        mode,
        status: 'healthy',
        reachability: 'reachable',
        capabilities: input.capabilities ?? [],
        createdAt: now.toISOString()
      }
    },
    async createNodeTicket(input: CreateNodeTicketRequest & { createdBy: ActorId }) {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + ((input.expiresInSeconds ?? 300) * 1000))
      const ticket = createJoinTicket()
      const ticketHash = await hashNodeToken(ticket)
      const ticketId = crypto.randomUUID()
      await db.insert(nodeJoinTickets).values({
        id: ticketId,
        ticketHash,
        kind: input.kind,
        name: input.name,
        capabilities: input.capabilities ?? [],
        status: 'active',
        expiresAt,
        createdBy: input.createdBy,
        createdAt: now
      })
      return {
        ticketId,
        ticket,
        expiresAt: expiresAt.toISOString()
      }
    },
    async issueNodeCredential(nodeId: string) {
      const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
      if (!node) return null
      const token = mintNodeToken()
      const tokenHash = await hashNodeToken(token)
      const now = new Date()
      // 重签发会先撤销旧 token，确保每个节点同一时刻只有一个 active 凭据。
      await db
        .update(nodeCredentials)
        .set({ status: 'revoked', revokedAt: now })
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
      await db.insert(nodeCredentials).values({
        id: crypto.randomUUID(),
        nodeId,
        tokenHash,
        status: 'active',
        issuedAt: now
      })
      return {
        nodeId,
        token,
        issuedAt: now.toISOString()
      }
    },
    async hasActiveNodeCredential(nodeId: string) {
      const [credential] = await db
        .select()
        .from(nodeCredentials)
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
        .limit(1)
      return Boolean(credential)
    },
    async validateNodeCredential(nodeId: string, token: string) {
      const [credential] = await db
        .select()
        .from(nodeCredentials)
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
        .limit(1)
      if (!credential) return false
      const tokenHash = await hashNodeToken(token)
      if (tokenHash !== credential.tokenHash) return false
      // lastUsedAt 用于后续安全审计和运行态诊断，不参与授权结论本身。
      await db
        .update(nodeCredentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(nodeCredentials.id, credential.id))
      return true
    },
    async listNodes() {
      const rows = await db.select().from(nodes)
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as MNode['kind'],
        name: row.name,
        mode: row.mode as MNode['mode'],
        status: row.status as MNode['status'],
        reachability: row.reachability as MNode['reachability'],
        ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
        ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
        capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
        createdAt: row.createdAt.toISOString()
      }))
    },
    async getNode(id: string) {
      const rows = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1)
      const row = rows[0]
      return row
        ? {
            id: row.id,
            kind: row.kind as MNode['kind'],
            name: row.name,
            mode: row.mode as MNode['mode'],
            status: row.status as MNode['status'],
            reachability: row.reachability as MNode['reachability'],
            ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
            ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
            capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
            createdAt: row.createdAt.toISOString()
          }
        : null
    },
    async assignTask(input: AssignTaskRequest) {
      const nodeRows = await db.select().from(nodes).where(eq(nodes.id, input.leafNodeId)).limit(1)
      if (nodeRows[0]?.kind !== 'leaf') throw new Error('target must be an existing Leaf node')
      const now = new Date()
      const id = crypto.randomUUID()
      await db.insert(tasks).values({
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'completed',
        createdAt: now,
        completedAt: now
      })
      return {
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'completed',
        createdAt: now.toISOString(),
        completedAt: now.toISOString()
      }
    },
    async createTaskRequest(input: AssignTaskRequest) {
      const nodeRows = await db.select().from(nodes).where(eq(nodes.id, input.leafNodeId)).limit(1)
      if (nodeRows[0]?.kind !== 'leaf') throw new Error('target must be an existing Leaf node')
      const now = new Date()
      const id = crypto.randomUUID()
      await db.insert(tasks).values({
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'requested',
        createdAt: now
      })
      return {
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'requested',
        createdAt: now.toISOString()
      }
    },
    async completeTask(input: { taskId: string; completedAt: string }) {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1)
      if (!task) return null
      const completedAt = new Date(input.completedAt)
      await db
        .update(tasks)
        .set({ status: 'completed', completedAt })
        .where(eq(tasks.id, input.taskId))
      return {
        id: task.id,
        leafNodeId: task.leafNodeId,
        type: 'noop',
        status: 'completed',
        createdAt: task.createdAt.toISOString(),
        completedAt: completedAt.toISOString()
      }
    },
    async getTask(id: string) {
      const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
      const row = rows[0]
      if (!row) return null
      const task: MTask = {
        id: row.id,
        leafNodeId: row.leafNodeId,
        type: 'noop',
        status: row.status as MTask['status'],
        createdAt: row.createdAt.toISOString()
      }
      if (row.completedAt) task.completedAt = row.completedAt.toISOString()
      return task
    },
    async registerService(input: unknown) {
      const definition = input as { id?: string; version?: string; domain?: string; kind?: string }
      const now = new Date()
      await db.insert(serviceDefinitions).values({
        id: definition.id ?? crypto.randomUUID(),
        version: definition.version ?? '0.1.0',
        domain: definition.domain ?? 'unknown',
        kind: definition.kind ?? 'service',
        definition: input,
        createdAt: now,
        updatedAt: now
      })
      return input
    },
    async listServices() {
      return db.select().from(serviceDefinitions)
    }
  }
}

export async function createProductionDeps(): Promise<CoreDeps & { close(): Promise<void> }> {
  const { db, client } = createDb()
  const natsUrl = process.env.NATS_URL ?? 'ws://localhost:4223'
  const readinessChecks = async (): Promise<CoreDependencies> => {
    const postgresReady = await client`select 1`
      .then(() => 'ready' as const)
      .catch(() => 'unavailable' as const)
    const natsReady = await connectToNats(natsUrl)
      .then(async (nc) => {
        await nc.drain()
        return 'ready' as const
      })
      .catch(() => 'unavailable' as const)
    const [policyReady, logReady, eventBusReady, mNetReady] = await Promise.all([
      dependencyStateFromReady(`${serviceUrl('m-policy')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-log')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-eventbus')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-net')}/ready`)
    ])
    return {
      postgres: postgresReady,
      nats: natsReady,
      'm-policy': policyReady,
      'm-log': logReady,
      'm-eventbus': eventBusReady,
      'm-net': mNetReady
    }
  }
  const storage = createDbStorage(db, readinessChecks)
  return {
    startedAt: Date.now(),
    version: '0.1.0',
    joinIngressPublicUrl: process.env.MERISTEM_JOIN_PUBLIC_URL ?? 'https://localhost:8443',
    auth: createJwtAuthPort(),
    policy: createHttpPolicyPort(),
    log: createHttpLogPort(),
    events: createHttpEventPort(),
    mNet: createHttpMNetPort(),
    agentTasks: createHttpAgentTaskPort(),
    services: createServiceLifecyclePort(storage, readinessChecks),
    storage,
    async close() {
      await client.end()
    }
  }
}

/**
 * HTTP 边界统一从 Authorization 头提取 Bearer token，避免路由层复制解析细节。
 */
export function bearerTokenFromRequest(request: Request): string | null {
  return extractBearerToken(request.headers.get('authorization') ?? undefined)
}
