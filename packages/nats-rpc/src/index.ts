import { wsconnect, type NatsConnection } from '@nats-io/nats-core'

// 主题常量集中定义，避免不同服务各自手写 subject 导致拼写漂移。
export const subjects = {
  policyAuthorize: 'mpolicy.authorize.v0',
  policyDecisionGet: 'mpolicy.decision.get.v0',
  timelineWrite: 'mlog.timeline.write.v0',
  fullWrite: 'mlog.full.write.v0',
  auditWrite: 'mlog.audit.write.v0',
  timelineList: 'mlog.timeline.list.v0',
  fullList: 'mlog.full.list.v0',
  auditList: 'mlog.audit.list.v0',
  eventPublish: 'meventbus.publish.v0',
  networkCreate: 'mnet.network.create.v0',
  networkList: 'mnet.network.list.v0',
  networkJoin: 'mnet.network.join.v0',
  networkMembersList: 'mnet.network.members.list.v0',
  nodeHeartbeatReported: 'nodeagent.heartbeat.reported.v0',
  nodeLogForwarded: 'nodeagent.log.forwarded.v0',
  nodeTaskExecute(nodeId: string) {
    return `nodeagent.${nodeId}.task.execute.v0`
  }
} as const

export type RpcClient = {
  request<TRequest, TResponse>(subject: string, payload: TRequest, timeoutMs?: number): Promise<TResponse>
  publish<TPayload>(subject: string, payload: TPayload): void
  close(): Promise<void>
}

/**
 * Bun 运行时统一走官方 WebSocket transport，避免继续依赖 Node/Bun TCP transport 包。
 */
export function toNatsWebSocketUrl(natsUrl: string): string {
  if (natsUrl.startsWith('ws://') || natsUrl.startsWith('wss://')) return natsUrl
  const url = new URL(natsUrl.replace(/^nats:\/\//, 'http://').replace(/^tls:\/\//, 'https://'))
  const protocol = natsUrl.startsWith('tls://') ? 'wss' : 'ws'
  const port = url.port === '' || url.port === '4222' ? '4223' : url.port
  return `${protocol}://${url.hostname}:${port}`
}

/**
 * 所有 NATS 连接统一在这里收敛成 Bun + WebSocket 入口，避免服务各自散落 transport 选择逻辑。
 */
export async function connectToNats(natsUrl = process.env.NATS_URL ?? 'ws://localhost:4223'): Promise<NatsConnection> {
  return wsconnect({ servers: toNatsWebSocketUrl(natsUrl) })
}

export async function createNatsRpcClient(natsUrl = process.env.NATS_URL ?? 'ws://localhost:4223'): Promise<RpcClient> {
  const nc = await connectToNats(natsUrl)
  return createRpcClientFromConnection(nc)
}

/**
 * RpcClient 只是对 NATS request/reply 的薄封装，保证调用方维持统一 JSON 语义。
 */
export function createRpcClientFromConnection(nc: NatsConnection): RpcClient {
  return {
    async request<TRequest, TResponse>(subject: string, payload: TRequest, timeoutMs = 1000): Promise<TResponse> {
      const response = await nc.request(subject, JSON.stringify(payload), { timeout: timeoutMs })
      return response.json<TResponse>()
    },
    publish<TPayload>(subject: string, payload: TPayload): void {
      nc.publish(subject, JSON.stringify(payload))
    },
    async close(): Promise<void> {
      await nc.drain()
    }
  }
}

/**
 * JSON RPC 服务端统一在这里处理解析、执行业务处理器和错误回包，
 * 避免每个服务重复写一套循环与异常映射。
 */
export async function serveJsonRequests<TRequest, TResponse>(
  nc: NatsConnection,
  subject: string,
  handler: (request: TRequest) => Promise<TResponse>
): Promise<void> {
  const subscription = nc.subscribe(subject)
  for await (const message of subscription) {
    try {
      const request = message.json<TRequest>()
      const response = await handler(request)
      message.respond(JSON.stringify(response))
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'unknown_error'
      message.respond(JSON.stringify({ ok: false, error: messageText }))
    }
  }
}
