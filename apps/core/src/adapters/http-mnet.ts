import { edenTreaty } from '@elysiajs/eden'
import type { MNetApp } from '@m-net/public-types.ts'
import { Effect } from 'effect'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNode,
  NetworkSummary,
  NodeControlAction,
  NodeControlResponse,
  NodeControlResponseFromSchema
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import {
  createInternalFetcher,
  requireServiceRoute,
  runServiceEffect,
  serviceErrorFromHttpResponse,
  tryServiceCall
} from '../effect-helpers.ts'
import {
  decodeMNetCreateNetworkResponse as decodeCreateNetworkResponse,
  decodeMNetJoinNetworkResponse as decodeJoinNetworkResponse,
  decodeMNetMemberRemoveResponse as decodeMemberRemoveResponse,
  decodeMNetNetworkDeleteResponse as decodeNetworkDeleteResponse,
  decodeMNetNetworkListResponse as decodeNetworkListResponse,
  decodeMNetNetworkMembersResponse as decodeNetworkMembersResponse,
  decodeMNetNetworkUpdateResponse as decodeNetworkUpdateResponse,
  decodeMNetNodeControlResponse as decodeNodeControlResponse
} from './mnet-response-decode.ts'

function normalizeMNetNode(node: NodeControlResponseFromSchema['node']): MNode {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    mode: node.mode,
    status: node.status,
    reachability: node.reachability,
    capabilities: [...node.capabilities],
    createdAt: node.createdAt,
    ...(node.lastSeenAt !== undefined ? { lastSeenAt: node.lastSeenAt } : {}),
    ...(node.agentVersion !== undefined ? { agentVersion: node.agentVersion } : {})
  }
}

function normalizeNodeControlResponse(
  response: NodeControlResponseFromSchema
): NodeControlResponse {
  return {
    node: normalizeMNetNode(response.node),
    policyDecisionId: response.policyDecisionId,
    correlationId: response.correlationId
  }
}

/**
 * Core 到 M-Net 的同步网络调用改走 loopback HTTP + Eden，避免继续把业务边界压在 NATS RPC 上。
 */
export function createHttpMNetPort() {
  const baseUrl = serviceUrl('m-net')
  const client = edenTreaty<MNetApp>(serviceUrl('m-net'), { fetcher: createInternalFetcher() })
  type EdenEnvelope<T> = {
    data: T | null
    error: { value: unknown; status: number } | null
    status: number
  }
  // Eden 的类型路由映射是静态对象，无法用运行时 networkId 建立索引；此处双重断言只放宽
  // 路由查找形状，响应体仍逐一经 mnet-response-decode.ts 的契约 schema 解码后才进入控制面。
  const networkRoutes = client.internal.v0.networks as unknown as Record<
    string,
    {
      members: {
        post(params: { nodeId: string }): Promise<EdenEnvelope<unknown>>
        get(params: Record<string, never>): Promise<EdenEnvelope<unknown>>
      }
      delete(): Promise<EdenEnvelope<unknown>>
      patch(params: { displayName?: string }): Promise<EdenEnvelope<unknown>>
    }
  >
  const memberDeleteRoutes = client.internal.v0.networks as unknown as Record<
    string,
    {
      members: Record<string, { delete(): Promise<EdenEnvelope<unknown>> }>
    }
  >

  // M-Net 响应经契约 schema 解码后，仍需显式映射为 Core 端口类型；
  // 可选 displayName 用条件展开，避免 Effect optional 的 `| undefined` 泄漏到端口契约。
  function toMNetwork(network: {
    id: string
    name: string
    displayName?: string | undefined
    profileVersion: string
    status: string
    createdAt: string
  }): MNetwork {
    return {
      id: network.id,
      name: network.name,
      ...(network.displayName !== undefined ? { displayName: network.displayName } : {}),
      profileVersion: network.profileVersion,
      status: 'active' as const,
      createdAt: network.createdAt
    }
  }

  function toNetworkSummary(summary: {
    id: string
    name: string
    displayName?: string | undefined
    profileVersion: string
    status: string
    createdAt: string
    memberCount: number
  }): NetworkSummary {
    return {
      id: summary.id,
      name: summary.name,
      ...(summary.displayName !== undefined ? { displayName: summary.displayName } : {}),
      profileVersion: summary.profileVersion,
      status: 'active' as const,
      createdAt: summary.createdAt,
      memberCount: summary.memberCount
    }
  }

  return {
    async createNetwork(input: CreateNetworkRequest) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.networks.post(input), {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeCreateNetworkResponse(response.data)
          ),
          Effect.map(response => toMNetwork(response.network))
        )
      )
    },
    async listNetworks() {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.networks.get({}), {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeNetworkListResponse(response.data)
          ),
          Effect.map(response => response.networks.map(toNetworkSummary))
        )
      )
    },
    async joinNetwork(input: { networkId: string; nodeId: string }) {
      return runServiceEffect(
        requireServiceRoute(networkRoutes[input.networkId], {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(route =>
            tryServiceCall(() => route.members.post({ nodeId: input.nodeId }), {
              code: 'mnet.unavailable',
              message: 'M-Net unavailable'
            })
          ),
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeJoinNetworkResponse(response.data)
          ),
          Effect.map(response => ({ ...response.member }))
        )
      )
    },
    async listNetworkMembers(networkId: string) {
      return runServiceEffect(
        requireServiceRoute(networkRoutes[networkId], {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(route =>
            tryServiceCall(() => route.members.get({}), {
              code: 'mnet.unavailable',
              message: 'M-Net unavailable'
            })
          ),
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeNetworkMembersResponse(response.data)
          ),
          Effect.map(response => response.members.map(member => ({ ...member })))
        )
      )
    },
    async deleteNetwork(input: { networkId: string }) {
      return runServiceEffect(
        requireServiceRoute(networkRoutes[input.networkId], {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(route =>
            tryServiceCall(() => route.delete(), {
              code: 'mnet.unavailable',
              message: 'M-Net unavailable'
            })
          ),
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeNetworkDeleteResponse(response.data)
          ),
          Effect.map(response => ({ networkId: response.networkId }))
        )
      )
    },
    async removeMember(input: { networkId: string; nodeId: string }) {
      return runServiceEffect(
        requireServiceRoute(memberDeleteRoutes[input.networkId], {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(route => {
            const memberRoute = route.members[input.nodeId]
            if (!memberRoute) {
              return Effect.fail({
                code: 'mnet.unavailable',
                message: 'M-Net member route unavailable'
              } as const)
            }
            return tryServiceCall(() => memberRoute.delete(), {
              code: 'mnet.unavailable',
              message: 'M-Net unavailable'
            })
          }),
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeMemberRemoveResponse(response.data)
          )
        )
      )
    },
    async updateNetworkMetadata(input: { networkId: string; displayName?: string }) {
      return runServiceEffect(
        requireServiceRoute(networkRoutes[input.networkId], {
          code: 'mnet.unavailable',
          message: 'M-Net unavailable'
        }).pipe(
          Effect.flatMap(route =>
            tryServiceCall(
              () =>
                route.patch(
                  input.displayName !== undefined ? { displayName: input.displayName } : {}
                ),
              {
                code: 'mnet.unavailable',
                message: 'M-Net unavailable'
              }
            )
          ),
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
              : decodeNetworkUpdateResponse(response.data)
          ),
          Effect.map(response => toMNetwork(response.network))
        )
      )
    },
    async controlNode(input: {
      nodeId: string
      action: NodeControlAction
      reason: string
      targetKind?: 'stem' | 'leaf'
      bearerToken: string
    }) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const response = await fetch(
              `${baseUrl}/api/v0/nodes/${encodeURIComponent(input.nodeId)}/control`,
              {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${input.bearerToken}`,
                  'content-type': 'application/json'
                },
                body: JSON.stringify({
                  action: input.action,
                  reason: input.reason,
                  ...(input.targetKind ? { targetKind: input.targetKind } : {})
                })
              }
            )
            const data = await response.json()
            return { ok: response.ok, data }
          },
          { code: 'mnet.unavailable', message: 'M-Net unavailable' }
        ).pipe(
          Effect.flatMap(response =>
            response.ok
              ? decodeNodeControlResponse(response.data)
              : Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.data,
                    'mnet.unavailable',
                    'M-Net unavailable'
                  )
                )
          ),
          Effect.map(normalizeNodeControlResponse)
        )
      )
    }
  }
}
