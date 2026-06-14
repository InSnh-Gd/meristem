import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/route-support.ts'
import {
  apiErrorSchema,
  networkMemberSchema,
  networkSchema,
  networkSummarySchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'

export function networksRoutes(deps: CoreDeps) {
  return new Elysia()
    .post(
      '/api/v0/networks',
      async ({ body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.network.create', headers, async () => {
          const auth = await requireActor(deps, headers)
          const permission = await authorize(deps, {
            actor: auth.actor,
            action: 'network:create',
            resource: `network:${body.name}`,
            correlationId: auth.correlationId
          })

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'network:create',
            resource: `network:${body.name}`,
            decisionId: permission.id,
            result: permission.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok)
            throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)

          const created = await deps.mNet.createNetwork(body)
          if (!created.ok)
            throw new CoreError(
              statusCodeForServiceError(created.error.code),
              created.error.code,
              created.error.message,
              auth.correlationId
            )

          await deps.events.publish(
            'mnet.network.created.v0',
            tracedEvent({
              type: 'mnet.network.created',
              source: 'meristem-core',
              payload: {
                networkId: created.value.id,
                name: created.value.name,
                profileVersion: created.value.profileVersion
              },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `created network ${created.value.name}`,
            subject: created.value.id,
            correlationId: auth.correlationId
          })

          return {
            network: created.value,
            policyDecisionId: permission.id,
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
        const auth = await requireActor(deps, headers)
        const _permission = await authorize(deps, {
          actor: auth.actor,
          action: 'network:read',
          resource: 'networks',
          correlationId: auth.correlationId
        })

        const networks = await deps.mNet.listNetworks()
        if (!networks.ok) {
          throw new CoreError(
            statusCodeForServiceError(networks.error.code),
            networks.error.code,
            networks.error.message,
            auth.correlationId
          )
        }
        return { networks: networks.value }
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
          const auth = await requireActor(deps, headers)
          const permission = await authorize(deps, {
            actor: auth.actor,
            action: 'network:join',
            resource: `network:${params.id}:node:${body.nodeId}`,
            correlationId: auth.correlationId
          })

          const audit = await deps.log.writeAudit({
            actor: auth.actor,
            action: 'network:join',
            resource: `network:${params.id}:node:${body.nodeId}`,
            decisionId: permission.id,
            result: permission.result,
            correlationId: auth.correlationId
          })
          if (!audit.ok)
            throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)

          const member = await deps.mNet.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
          if (!member.ok) {
            throw new CoreError(
              statusCodeForServiceError(member.error.code),
              member.error.code,
              member.error.message,
              auth.correlationId
            )
          }

          await deps.events.publish(
            'mnet.membership.joined.v0',
            tracedEvent({
              type: 'mnet.membership.joined',
              source: 'meristem-core',
              payload: {
                networkId: member.value.networkId,
                nodeId: member.value.nodeId,
                nodeKind: member.value.nodeKind,
                membershipMode: member.value.membershipMode
              },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeTimeline({
            summary: `joined node ${member.value.nodeId} to network ${member.value.networkId}`,
            subject: member.value.networkId,
            correlationId: auth.correlationId
          })

          return {
            member: member.value,
            policyDecisionId: permission.id,
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
        const auth = await requireActor(deps, headers)
        const _permission = await authorize(deps, {
          actor: auth.actor,
          action: 'network:read',
          resource: `network:${params.id}`,
          correlationId: auth.correlationId
        })

        const members = await deps.mNet.listNetworkMembers(params.id)
        if (!members.ok) {
          throw new CoreError(
            statusCodeForServiceError(members.error.code),
            members.error.code,
            members.error.message,
            auth.correlationId
          )
        }
        return { members: members.value }
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
