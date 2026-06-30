import * as Schema from 'effect/Schema'
import { Elysia } from 'elysia'
import {
  BffOperationalProofPathResponseSchema,
  type MNetOperationalSnapshotFromSchema,
  MNetOperationalSnapshotSchema,
  NetworkListResponseSchema,
  NetworkMembersResponseSchema,
  SessionResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  BffDataPlaneStatusResponseSchema,
  BffJoinTicketListResponseSchema,
  mapOperationalSnapshotToProofPath
} from './mnet-dataplane-support.ts'
import {
  decodeUpstreamData,
  fetchDecodedUpstream,
  requireBearerToken,
  withStateSource,
  withStateSourceDetail
} from './route-helpers.ts'
import { networkIdParamsSchema } from './route-schemas.ts'

function relayEndpointFromOperationalSnapshot(snapshot: MNetOperationalSnapshotFromSchema) {
  const selector = snapshot.forcedRelay.selector
  if (!snapshot.forcedRelay.active || !selector) return 'not-configured'
  switch (selector.selectorType) {
    case 'all-leaf-nodes':
      return 'all-leaf-nodes'
    case 'node-ids':
      return selector.nodeIds.join(',') || 'node-ids'
    case 'label-selector':
      return Object.entries(selector.matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(',') || 'label-selector'
  }
}

/**
 * createBffMNetDataplaneRoutes 聚合 M-Net proof-path 面板所需公开读模型。
 * BFF 只消费公开 REST fact，并把 UI 需要的组合形状下沉到 support mapper。
 */
export function createBffMNetDataplaneRoutes({ cf, mf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/networks/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const [networks, members, operationalState, dataPlaneStatus] = await Promise.all([
          fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/networks',
            token,
            schema: NetworkListResponseSchema,
            errorMessage: 'Core returned invalid network list payload'
          }),
          fetchDecodedUpstream({
            fetcher: cf,
            path: `/api/v0/networks/${params.id}/members`,
            token,
            schema: NetworkMembersResponseSchema,
            errorMessage: 'Core returned invalid network member list payload'
          }),
          fetchDecodedUpstream({
            fetcher: mf,
            path: `/api/v0/networks/${params.id}/operational-state`,
            token,
            schema: MNetOperationalSnapshotSchema,
            errorMessage: 'M-Net returned invalid operational state payload'
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
        if (operationalState instanceof Response) return operationalState
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

        const relayAssignment = operationalState.forcedRelay.active
          ? {
              relayType: operationalState.forcedRelay.routeClass ?? 'forced-relay',
              relayEndpoint: relayEndpointFromOperationalSnapshot(operationalState),
              nodeIds: operationalState.forcedRelay.affectedNodeIds
            }
          : {
              relayType: 'unknown',
              relayEndpoint: 'unknown',
              nodeIds: [] as string[]
            }

        return {
          network: withStateSource(network, {
            sourceType: 'authoritative',
            sourceId: `core:/api/v0/networks/${params.id}`
          }),
          members: members.members.map(member =>
            withStateSource(member, {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/networks/${params.id}/members/${member.nodeId}`
            })
          ),
          profileState: {
            profileVersion: network.profileVersion,
            stateSource: {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/network-profiles/${network.profileVersion}`
            }
          },
          networkMapSummary: {
            networkId: params.id,
            mapVersion: operationalState.topology.topologyRevision ?? 'unavailable',
            memberCount: operationalState.topology.nodes.length,
            aclRuleCount: operationalState.topology.edges.length,
            relayAssignment,
            expiresAt: operationalState.network.lastUpdatedAt,
            signedBy: operationalState.eventStream.lastEventId ?? 'unknown',
            stateSource: {
              sourceType: 'read-model',
              sourceId: `mnet:/api/v0/networks/${params.id}/operational-state#topology`
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
        detail: withStateSourceDetail('Read M-Net network detail with public topology facts', [
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
        const snapshot = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/networks/${params.id}/operational-state`,
          token,
          schema: MNetOperationalSnapshotSchema,
          errorMessage: 'M-Net returned invalid operational state payload'
        })
        if (snapshot instanceof Response) return snapshot
        return {
          networkId: params.id,
          relayAssignment: snapshot.forcedRelay.active
            ? {
                relayType: snapshot.forcedRelay.routeClass ?? 'forced-relay',
                relayEndpoint: relayEndpointFromOperationalSnapshot(snapshot),
                nodeIds: snapshot.forcedRelay.affectedNodeIds
              }
            : {
                relayType: 'unknown',
                relayEndpoint: 'unknown',
                nodeIds: []
              },
          stateSource: {
            sourceType: 'read-model',
            sourceId: `mnet:/api/v0/networks/${params.id}/operational-state#forcedRelay`
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
        const snapshot = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/networks/${params.id}/operational-state`,
          token,
          schema: MNetOperationalSnapshotSchema,
          errorMessage: 'M-Net returned invalid operational state payload'
        })
        if (snapshot instanceof Response) return snapshot
        return {
          networkId: params.id,
          mapVersion: snapshot.topology.topologyRevision ?? 'unavailable',
          memberCount: snapshot.topology.nodes.length,
          aclRuleCount: snapshot.topology.edges.length,
          relayAssignment: snapshot.forcedRelay.active
            ? {
                relayType: snapshot.forcedRelay.routeClass ?? 'forced-relay',
                relayEndpoint: relayEndpointFromOperationalSnapshot(snapshot),
                nodeIds: snapshot.forcedRelay.affectedNodeIds
              }
            : {
                relayType: 'unknown',
                relayEndpoint: 'unknown',
                nodeIds: []
              },
          expiresAt: snapshot.network.lastUpdatedAt,
          signedBy: snapshot.eventStream.lastEventId ?? 'unknown',
          stateSource: {
            sourceType: 'read-model',
            sourceId: `mnet:/api/v0/networks/${params.id}/operational-state#topology`
          }
        }
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read network-map summary for one network', ['read-model'])
      }
    )
    .get(
      '/api/v0/networks/:id/operational-state',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const result = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/networks/${params.id}/operational-state`,
          token,
          schema: MNetOperationalSnapshotSchema,
          errorMessage: 'M-Net returned invalid operational state payload'
        })
        if (result instanceof Response) return result

        return {
          ...result,
          stateSource: {
            sourceType: 'read-model',
            sourceId: `mnet:/api/v0/networks/${params.id}/operational-state`
          }
        }
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read network operational read model state', ['read-model'])
      }
    )
    .get(
      '/api/v0/networks/:id/proof-path',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const [sessionRes, operationalRes] = await Promise.all([
          cf('/api/v0/session', token),
          mf(`/api/v0/networks/${params.id}/operational-state`, token)
        ])
        if (!sessionRes.ok) return new Response(JSON.stringify(sessionRes.data), {
          status: sessionRes.status || 502,
          headers: { 'content-type': 'application/json' }
        })
        if (!operationalRes.ok) return new Response(JSON.stringify(operationalRes.data), {
          status: operationalRes.status || 502,
          headers: { 'content-type': 'application/json' }
        })

        const session = decodeUpstreamData(
          SessionResponseSchema,
          sessionRes.data,
          'Core returned invalid session payload'
        )
        if (session instanceof Response) return session
        const operational = decodeUpstreamData(
          MNetOperationalSnapshotSchema,
          operationalRes.data,
          'M-Net returned invalid operational state payload'
        )
        if (operational instanceof Response) return operational

        return Schema.decodeUnknownSync(BffOperationalProofPathResponseSchema)(
          mapOperationalSnapshotToProofPath(operational, session.permissions)
        )
      },
      {
        params: networkIdParamsSchema,
        detail: withStateSourceDetail('Read proof-path network management contract', [
          'authoritative',
          'read-model',
          'policy'
        ])
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
