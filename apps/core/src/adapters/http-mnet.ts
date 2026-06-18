import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import type {
  CreateNetworkRequest,
  MNetworkMember
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { MNetApp } from '../../../../services/m-net/src/public-types.ts'
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
  decodeMNetNetworkListResponse as decodeNetworkListResponse,
  decodeMNetNetworkMembersResponse as decodeNetworkMembersResponse
} from './mnet-response-decode.ts'

/**
 * Core 到 M-Net 的同步网络调用改走 loopback HTTP + Eden，避免继续把业务边界压在 NATS RPC 上。
 */
export function createHttpMNetPort() {
  const client = edenTreaty<MNetApp>(serviceUrl('m-net'), { fetcher: createInternalFetcher() })
  const networkRoutes = client.internal.v0.networks as Record<
    string,
    {
      members: {
        post(params: { nodeId: string }): Promise<{
          data: { member: MNetworkMember } | null
          error: { value: unknown; status: number } | null
          status: number
        }>
        get(params: Record<string, never>): Promise<{
          data: { members: MNetworkMember[] } | null
          error: { value: unknown; status: number } | null
          status: number
        }>
      }
    }
  >

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
          Effect.map(response => ({ ...response.network }))
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
          Effect.map(response => response.networks.map(network => ({ ...network })))
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
    }
  }
}
