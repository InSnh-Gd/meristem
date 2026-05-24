import { edenTreaty } from '@elysiajs/eden'
import type { CoreApp } from '../../core/src/app.ts'
import type {
  CreateNodeTicketResponse,
  CreateNetworkResponse,
  HealthResponse,
  IssueNodeCredentialResponse,
  JoinNetworkResponse,
  ReadyResponse,
  RegisterNodeResponse,
  ServiceListResponse,
  ServiceReloadResponse,
  SubmitTaskResponse,
  TaskControlResponse,
  TaskListResponse,
  TaskRetryNotImplementedResponse,
  TaskStatusResponse,
  StatusResponse,
  ProjectionHealth,
  BackfillParams,
  BackfillResult,
  DLQRecord
} from '../../../packages/contracts/src/index.ts'
import { createDynamicRouteAdapter } from '../../../packages/internal-http/src/dynamic-routes.ts'
import { injectTraceHeaders } from '../../../packages/telemetry/src/index.ts'
import type { CliClient } from './cli.ts'

type CliConfig = {
  coreUrl: string
  taskUrl: string
  token: string | undefined
}

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

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
    (input: FetchInput, init?: FetchInit) =>
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
  const coreRoutes = createDynamicRouteAdapter({
    baseUrl: config.coreUrl,
    defaultHeaders: headers,
    traceHeaders: () => injectTraceHeaders({})
  })
  const taskRoutes = createDynamicRouteAdapter({
    baseUrl: config.taskUrl,
    defaultHeaders: headers,
    traceHeaders: () => injectTraceHeaders({})
  })
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
    submitTask: async (input) => {
      const result = await taskRoutes.postJson<SubmitTaskResponse>('/api/v0/tasks', { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    cancelTask: async (taskId) => {
      const result = await taskRoutes.postJson<TaskControlResponse>('/api/v0/tasks/:id/cancel', { params: { id: taskId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getTask: async (taskId) => {
      const result = await taskRoutes.getJson('/api/v0/tasks/:id', { params: { id: taskId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as TaskStatusResponse
    },
    listTasks: async () => {
      const result = await taskRoutes.getJson('/api/v0/tasks')
      if (!result.ok) throw new Error(result.error.message)
      return result.value as TaskListResponse
    },
    retryTask: async (taskId) => {
      const result = await taskRoutes.postJson<TaskRetryNotImplementedResponse>('/api/v0/tasks/:id/retry', { params: { id: taskId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    listServices: async () => unwrap<ServiceListResponse>(client.api.v0.services.get({ $headers: headers })),
    reloadService: async (serviceId, reason) => {
      const route = serviceRoutes[serviceId]
      if (!route) throw new Error('service route unavailable')
      return unwrap<ServiceReloadResponse>(route.reload.post({ ...(reason ? { reason } : {}), $headers: headers }))
    },
    listTimeline: async () => unwrap(client.api.v0.logs.timeline.get({ $headers: headers })),
    listAudit: async () => unwrap(client.api.v0.audit.get({ $headers: headers })),
    projectionHealth: async () => unwrap<{ indices: ProjectionHealth[] }>(client.api.v0.projection.health.get({ $headers: headers })),
    backfill: async (input) => {
      const body: Record<string, unknown> = { index: input.index, batchSize: input.batchSize, $headers: headers }
      if (input.from !== null && input.from !== undefined) body.from = input.from
      if (input.to !== null && input.to !== undefined) body.to = input.to
      if (input.targetVersion !== undefined) body.targetVersion = input.targetVersion
      return unwrap<BackfillResult>(client.api.v0.projection.backfill.post(body as { index: string; from?: { factId: string; timestamp: string }; to?: { factId: string; timestamp: string }; batchSize: number; targetVersion?: string; $headers: Record<string, string> }))
    },
    listDLQ: async (index) => unwrap<{ records: DLQRecord[] }>(client.api.v0.projection.dlq.get({ $query: { ...(index ? { index } : {}) }, $headers: headers })),
    replayDLQ: async (dlqId) => {
      const result = await coreRoutes.postJson('/api/v0/projection/dlq/:id/replay', { params: { id: dlqId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    skipDLQ: async (dlqId) => {
      const result = await coreRoutes.postJson('/api/v0/projection/dlq/:id/skip', { params: { id: dlqId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}

export function configFromEnv(): CliConfig {
  // CLI 运行配置保持最小化，只依赖 Core 地址和 Bearer Token。
  return {
    coreUrl: process.env.MERISTEM_CORE_URL ?? 'http://localhost:3000',
    taskUrl: process.env.MERISTEM_TASK_URL ?? 'http://127.0.0.1:3105',
    token: process.env.MERISTEM_TOKEN
  }
}
