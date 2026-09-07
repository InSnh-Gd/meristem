import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import {
  apiErrorSchema,
  networkMemberSchema,
  networkSchema,
  networkSummarySchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  publishNetworkCreatedArtifacts,
  publishNetworkDeletedArtifacts,
  publishNetworkJoinedArtifacts,
  publishNetworkMemberRemovedArtifacts,
  requireNetworkMutationAccess,
  requireNetworkReadAccess,
  unwrapNetworkResult,
  writeNetworkAuditOrThrow
} from './networks-support.ts'

export function networksRoutes(deps: CoreDeps) {
  return new Elysia()
    .post(
      '/api/v0/networks',
      async ({ body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.network.create', headers, async () => {
          const resource = `network:${body.name}`
          const auth = await requireNetworkMutationAccess(deps, {
            headers,
            action: 'network:create',
            resource
          })

          await writeNetworkAuditOrThrow(deps, {
            actor: auth.actor,
            action: 'network:create',
            resource,
            permission: auth.permission,
            correlationId: auth.correlationId
          })

          const created = await unwrapNetworkResult(
            await deps.mNet.createNetwork(body),
            auth.correlationId
          )

          await publishNetworkCreatedArtifacts(deps, created, auth.correlationId)

          return {
            network: created,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          profileVersion: t.Optional(t.String({ minLength: 1 }))
        }),
        response: protectedResponse(
          t.Object({
            network: networkSchema,
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          { 409: apiErrorSchema, 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Create a logical network')
      }
    )
    .get(
      '/api/v0/networks',
      async ({ headers, status: _status }) => {
        const auth = await requireNetworkReadAccess(deps, headers, 'networks')
        const networks = await unwrapNetworkResult(
          await deps.mNet.listNetworks(),
          auth.correlationId
        )
        return { networks }
      },
      {
        response: protectedResponse(t.Object({ networks: t.Array(networkSummarySchema) }), {
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List logical networks')
      }
    )
    .post(
      '/api/v0/networks/:id/members',
      async ({ params, body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.network.join', headers, async () => {
          const resource = `network:${params.id}:node:${body.nodeId}`
          const auth = await requireNetworkMutationAccess(deps, {
            headers,
            action: 'network:join',
            resource
          })

          await writeNetworkAuditOrThrow(deps, {
            actor: auth.actor,
            action: 'network:join',
            resource,
            permission: auth.permission,
            correlationId: auth.correlationId
          })

          const member = await unwrapNetworkResult(
            await deps.mNet.joinNetwork({ networkId: params.id, nodeId: body.nodeId }),
            auth.correlationId
          )

          await publishNetworkJoinedArtifacts(deps, member, auth.correlationId)

          return {
            member,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        body: t.Object({ nodeId: t.String({ minLength: 1 }) }),
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(
          t.Object({
            member: networkMemberSchema,
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Join a node to a logical network')
      }
    )
    .get(
      '/api/v0/networks/:id/members',
      async ({ params, headers, status: _status }) => {
        const auth = await requireNetworkReadAccess(deps, headers, `network:${params.id}`)
        const members = await unwrapNetworkResult(
          await deps.mNet.listNetworkMembers(params.id),
          auth.correlationId
        )
        return { members }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(t.Object({ members: t.Array(networkMemberSchema) }), {
          404: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List network members')
      }
    )
    .delete(
      '/api/v0/networks/:id',
      async ({ params, headers }) => {
        return withExtractedSpan('meristem-core', 'core.network.delete', headers, async () => {
          const resource = `network:${params.id}`
          const auth = await requireNetworkMutationAccess(deps, {
            headers,
            action: 'network:delete',
            resource
          })

          await writeNetworkAuditOrThrow(deps, {
            actor: auth.actor,
            action: 'network:delete',
            resource,
            permission: auth.permission,
            correlationId: auth.correlationId
          })

          const deleted = await unwrapNetworkResult(
            await deps.mNet.deleteNetwork({ networkId: params.id }),
            auth.correlationId
          )

          await publishNetworkDeletedArtifacts(deps, deleted, auth.correlationId)

          return deleted
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(t.Object({ networkId: t.String() }), {
          404: apiErrorSchema,
          409: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('Delete an empty, profile-disabled logical network')
      }
    )
    .delete(
      '/api/v0/networks/:id/members/:nodeId',
      async ({ params, headers }) => {
        return withExtractedSpan(
          'meristem-core',
          'core.network.member.remove',
          headers,
          async () => {
            const resource = `network:${params.id}:node:${params.nodeId}`
            const auth = await requireNetworkMutationAccess(deps, {
              headers,
              action: 'network:delete',
              resource
            })

            await writeNetworkAuditOrThrow(deps, {
              actor: auth.actor,
              action: 'network:delete',
              resource,
              permission: auth.permission,
              correlationId: auth.correlationId
            })

            const removed = await unwrapNetworkResult(
              await deps.mNet.removeMember({ networkId: params.id, nodeId: params.nodeId }),
              auth.correlationId
            )

            await publishNetworkMemberRemovedArtifacts(deps, removed, auth.correlationId)

            return removed
          }
        )
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }), nodeId: t.String({ minLength: 1 }) }),
        response: protectedResponse(t.Object({ networkId: t.String(), nodeId: t.String() }), {
          404: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('Remove a node from a logical network')
      }
    )
    .patch(
      '/api/v0/networks/:id',
      async ({ params, body, headers }) => {
        return withExtractedSpan(
          'meristem-core',
          'core.network.metadata.update',
          headers,
          async () => {
            const resource = `network:${params.id}`
            const auth = await requireNetworkMutationAccess(deps, {
              headers,
              action: 'network:create',
              resource
            })

            const updated = await unwrapNetworkResult(
              await deps.mNet.updateNetworkMetadata({
                networkId: params.id,
                ...(body.displayName !== undefined ? { displayName: body.displayName } : {})
              }),
              auth.correlationId
            )

            return { network: updated }
          }
        )
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({ displayName: t.Optional(t.String({ minLength: 1 })) }),
        response: protectedResponse(t.Object({ network: networkSchema }), {
          404: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('Update logical network metadata')
      }
    )
}
