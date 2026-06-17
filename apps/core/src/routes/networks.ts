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
  publishNetworkJoinedArtifacts,
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
        const networks = await unwrapNetworkResult(await deps.mNet.listNetworks(), auth.correlationId)
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
}
