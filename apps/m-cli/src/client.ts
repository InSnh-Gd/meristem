import { edenTreaty } from '@elysiajs/eden'
import type { CoreApp } from '../../core/src/app.ts'
import type {
  AssignTaskResponse,
  CreateNodeTicketResponse,
  CreateNetworkResponse,
  HealthResponse,
  IssueNodeCredentialResponse,
  JoinNetworkResponse,
  ReadyResponse,
  RegisterNodeResponse,
  ServiceListResponse,
  ServiceReloadResponse,
  StatusResponse
} from '../../../packages/contracts/src/index.ts'
import { injectTraceHeaders } from '../../../packages/telemetry/src/index.ts'
import type { CliClient } from './cli.ts'

type CliConfig = {
  coreUrl: string
  token: string | undefined
}

/**
 * CLI 只负责透传 Bearer Token，不在本地推导角色或权限，避免把授权边界
 * 从 Core / M-Policy 偷偷复制到命令行进程里。
 */
function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

type EdenResponse<T> = {
  data: T | null
  error: { value: unknown; status: number } | null
  status: number
}

/**
 * CLI 统一从 Eden 错误体中提炼人类可读消息，保持脚本调用和人工调用看到同一套错误语义。
 */
function errorMessage(response: EdenResponse<unknown>): string {
  if (!response.error) return `request failed: ${response.status}`
  const value = response.error.value
  if (typeof value === 'object' && value !== null) {
    const error = Reflect.get(value, 'error')
    if (typeof error === 'object' && error !== null) {
      const message = Reflect.get(error, 'message')
      if (typeof message === 'string') return message
    }
  }
  return `request failed: ${response.status}`
}

/**
 * CLI 层只暴露解包后的契约结果；一旦 Core 返回错误或空数据，这里统一抛出异常给命令解析层处理。
 */
async function unwrap<T>(request: Promise<EdenResponse<unknown>>): Promise<T> {
  const response = await request as EdenResponse<T>
  if (response.error || response.data === null) throw new Error(errorMessage(response))
  return response.data
}

/**
 * CLI 官方客户端基于 Eden 调 Core，保持 Bun-only、类型安全和 trace 透传三项约束。
 */
export function createCoreClient(config: CliConfig): CliClient {
  // CLI 出站请求同样注入 trace 头，保证跨进程问题排查时能串起用户命令和内部调用。
  const fetcher = Object.assign(
    (input: URL | RequestInfo, init?: RequestInit) =>
      fetch(input, {
        ...init,
        headers: injectTraceHeaders(
          Object.fromEntries(
            new Headers(init?.headers).entries()
          )
        )
      }),
    { preconnect: fetch.preconnect }
  ) as typeof fetch
  const client = edenTreaty<CoreApp>(config.coreUrl, { fetcher })
  const headers = authHeaders(config.token)
  const networkRoutes = client.api.v0.networks as Record<
    string,
    {
      members: {
        post(params: { nodeId: string; $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
        get(params: { $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
      }
    }
  >
  const serviceRoutes = client.api.v0.services as Record<
    string,
    {
      reload: {
        post(params: { reason?: string; $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
      }
    }
  >
  const nodeRoutes = client.api.v0.nodes as Record<
    string,
    {
      credentials: {
        post(params: { $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
      }
    }
  >

  return {
    health: async () => unwrap<HealthResponse>(client.api.v0.health.get({})),
    ready: async () => unwrap<ReadyResponse>(client.api.v0.ready.get({})),
    status: async () => unwrap<StatusResponse>(client.api.v0.status.get({ $headers: headers })),
    registerNode: async (input) => unwrap<RegisterNodeResponse>(client.api.v0.nodes.post({ ...input, $headers: headers })),
    createNodeTicket: async (input) => unwrap<CreateNodeTicketResponse>(client.api.v0['node-tickets'].post({ ...input, $headers: headers })),
    issueNodeToken: async (nodeId) => {
      const route = nodeRoutes[nodeId]
      if (!route) throw new Error('node route unavailable')
      return unwrap<IssueNodeCredentialResponse>(route.credentials.post({ $headers: headers }))
    },
    listNodes: async () => unwrap(client.api.v0.nodes.get({ $headers: headers })),
    createNetwork: async (input) => unwrap<CreateNetworkResponse>(client.api.v0.networks.post({ ...input, $headers: headers })),
    listNetworks: async () => unwrap(client.api.v0.networks.get({ $headers: headers })),
    joinNetwork: async (input) => {
      const route = networkRoutes[input.networkId]
      if (!route) throw new Error('network route unavailable')
      return unwrap<JoinNetworkResponse>(route.members.post({ nodeId: input.nodeId, $headers: headers }))
    },
    listNetworkMembers: async (networkId) => {
      const route = networkRoutes[networkId]
      if (!route) throw new Error('network route unavailable')
      return unwrap(route.members.get({ $headers: headers }))
    },
    assignTask: async (input) => unwrap<AssignTaskResponse>(client.api.v0.tasks.post({ ...input, $headers: headers })),
    listServices: async () => unwrap<ServiceListResponse>(client.api.v0.services.get({ $headers: headers })),
    reloadService: async (serviceId, reason) => {
      const route = serviceRoutes[serviceId]
      if (!route) throw new Error('service route unavailable')
      return unwrap<ServiceReloadResponse>(route.reload.post({ ...(reason ? { reason } : {}), $headers: headers }))
    },
    listTimeline: async () => unwrap(client.api.v0.logs.timeline.get({ $headers: headers })),
    listAudit: async () => unwrap(client.api.v0.audit.get({ $headers: headers }))
  }
}

export function configFromEnv(): CliConfig {
  // CLI 运行配置保持最小化，只依赖 Core 地址和 Bearer Token。
  return {
    coreUrl: process.env.MERISTEM_CORE_URL ?? 'http://localhost:3000',
    token: process.env.MERISTEM_TOKEN
  }
}
