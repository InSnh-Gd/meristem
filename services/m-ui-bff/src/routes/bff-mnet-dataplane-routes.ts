import * as Schema from 'effect/Schema'
import { Elysia } from 'elysia'
import {
  NetworkListResponseSchema,
  NetworkMapResponseSchema,
  NetworkMembersResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  BffDataPlaneStatusResponseSchema,
  BffJoinTicketListResponseSchema,
  withInternalHeaders
} from './mnet-dataplane-support.ts'
import {
  fetchDecodedUpstream,
  requireBearerToken,
  withStateSource,
  withStateSourceDetail
} from './route-helpers.ts'
import { networkIdParamsSchema } from './route-schemas.ts'

/**
 * createBffMNetDataplaneRoutes 聚合 M-Net 数据面面板所需读模型，并为每条响应补充 stateSource。
 */
export function createBffMNetDataplaneRoutes({ cf, mf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/networks/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const [networks, members, mapSummary, dataPlaneStatus] = await Promise.all([
          fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/networks',
            token,
            schema: NetworkListResponseSchema,
            errorMessage: 'Core returned invalid network list payload'
          }),
          fetchDecodedUpstream({
            fetcher: mf,
            path: `/internal/v0/networks/${params.id}/members`,
            token,
            schema: NetworkMembersResponseSchema,
            errorMessage: 'M-Net returned invalid member list payload',
            init: withInternalHeaders()
          }),
          fetchDecodedUpstream({
            fetcher: mf,
            path: `/internal/v0/networks/${params.id}/network-map`,
            token,
            schema: NetworkMapResponseSchema,
            errorMessage: 'M-Net returned invalid network map payload',
            init: withInternalHeaders()
          }),
          fetchDecodedUpstream({
            fetcher: mf,
            path: `/api/v0/networks/${params.id}/dataplane/status`,
            token,
            schema: BffDataPlaneStatusResponseSchema,
            errorMessage: 'M-Net returned invalid data-plane status payload'
          })
        ])

        if (networks instanceof Response) return networks
        if (members instanceof Response) return members
        if (mapSummary instanceof Response) return mapSummary
        if (dataPlaneStatus instanceof Response) return dataPlaneStatus

        const network = networks.networks.find(candidate => candidate.id === params.id)
        if (!network) {
          return new Response(
            JSON.stringify({ error: { code: 'network.not_found', message: 'network not found' } }),
            {
              status: 404,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const relayAssignment = mapSummary.relayAssignment ?? {
          relayType: 'none',
          relayEndpoint: 'none',
          nodeIds: []
        }

        return {
          network: withStateSource(network, {
            sourceType: 'authoritative',
            sourceId: `core:/api/v0/networks/${params.id}`
          }),
          members: members.members.map(member =>
            withStateSource(member, {
              sourceType: 'authoritative',
              sourceId: `mnet:/internal/v0/networks/${params.id}/members/${member.nodeId}`
            })
          ),
          profileState: {
            profileVersion: network.profileVersion,
            stateSource: {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/networks/${params.id}/profile`
            }
          },
          networkMapSummary: {
            networkId: params.id,
            mapVersion: mapSummary.mapVersion,
            memberCount: mapSummary.members.length,
            aclRuleCount: mapSummary.aclRules.length,
            relayAssignment,
            expiresAt: mapSummary.expiresAt,
            signedBy: mapSummary.signedBy,
            stateSource: {
              sourceType: 'read-model',
              sourceId: `mnet:/internal/v0/networks/${params.id}/network-map`
            }
          },
          dataPlaneStatus,
          stateSource: {
            sourceType: 'authoritative',
            sourceId: `bff:/api/v0/networks/${params.id}`
          }
        }
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read M-Net network detail with members and topology', [
          'authoritative',
          'read-model'
        ])
      }
    )
    .get(
      '/api/v0/networks/:id/join-tickets',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/networks/${params.id}/join-tickets`,
          token,
          schema: BffJoinTicketListResponseSchema,
          errorMessage: 'M-Net returned invalid join ticket list payload'
        })
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('List M-Net join tickets for one network', ['authoritative'])
      }
    )
    .get(
      '/api/v0/networks/:id/dataplane/status',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/networks/${params.id}/dataplane/status`,
          token,
          schema: BffDataPlaneStatusResponseSchema,
          errorMessage: 'M-Net returned invalid data-plane status payload'
        })
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read M-Net data-plane tunnel and partition status', [
          'authoritative'
        ])
      }
    )
    .get(
      '/api/v0/networks/:id/dataplane/relay',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const map = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/internal/v0/networks/${params.id}/network-map`,
          token,
          schema: NetworkMapResponseSchema,
          errorMessage: 'M-Net returned invalid network map payload',
          init: withInternalHeaders()
        })
        if (map instanceof Response) return map
        return {
          networkId: params.id,
          relayAssignment: map.relayAssignment ?? {
            relayType: 'none',
            relayEndpoint: 'none',
            nodeIds: []
          },
          stateSource: {
            sourceType: 'read-model',
            sourceId: `mnet:/internal/v0/networks/${params.id}/network-map`
          }
        }
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read relay assignment summary for one network', [
          'read-model'
        ])
      }
    )
    .get(
      '/api/v0/networks/:id/dataplane/network-map',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const map = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/internal/v0/networks/${params.id}/network-map`,
          token,
          schema: NetworkMapResponseSchema,
          errorMessage: 'M-Net returned invalid network map payload',
          init: withInternalHeaders()
        })
        if (map instanceof Response) return map
        const summary = {
          networkId: params.id,
          mapVersion: map.mapVersion,
          memberCount: map.members.length,
          aclRuleCount: map.aclRules.length,
          relayAssignment: map.relayAssignment ?? {
            relayType: 'none',
            relayEndpoint: 'none',
            nodeIds: []
          },
          expiresAt: map.expiresAt,
          signedBy: map.signedBy,
          stateSource: {
            sourceType: 'read-model',
            sourceId: `mnet:/internal/v0/networks/${params.id}/network-map`
          }
        }
        return summary
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read network-map summary for one network', ['read-model'])
      }
    )
    .get(
      '/api/v0/networks/defaults',
      async ({ headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return fetchDecodedUpstream({
          fetcher: mf,
          path: '/api/v0/networks/profile-defaults',
          token,
          schema: Schema.Struct({
            defaultProfileVersion: Schema.String,
            globalSwitchState: Schema.String,
            updatedAt: Schema.String,
            switchOperationId: Schema.optional(Schema.String)
          }),
          errorMessage: 'M-Net returned invalid network defaults payload'
        })
      },
      {
        detail: withStateSourceDetail('Read M-Net global defaults and fleet migration state', [
          'authoritative'
        ])
      }
    )
}
