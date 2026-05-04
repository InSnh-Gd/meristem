import { connect, type NatsConnection } from '@nats-io/transport-node'

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
  networkMembersList: 'mnet.network.members.list.v0'
} as const

export type RpcClient = {
  request<TRequest, TResponse>(subject: string, payload: TRequest, timeoutMs?: number): Promise<TResponse>
  publish<TPayload>(subject: string, payload: TPayload): void
  close(): Promise<void>
}

export async function createNatsRpcClient(natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'): Promise<RpcClient> {
  const nc = await connect({ servers: natsUrl })
  return createRpcClientFromConnection(nc)
}

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
