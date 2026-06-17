import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import { CoreError } from '../core-error.ts'
import { apiErrorSchema, nodeSchema, protectedResponse, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  assertDirectNodeRegistrationAllowed,
  publishNodeRegistrationArtifacts,
  publishNodeTicketArtifacts,
  requireNodeCredential,
  requireNodeMutationAccess,
  requireNodeReadAccess,
  toNodeJoinTicketResponse,
  writeNodeAudit
} from './nodes-support.ts'

export function nodesRoutes(deps: CoreDeps) {
  return new Elysia()
    .post(
      '/api/v0/node-tickets',
      async ({ body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.node.ticket.create', headers, async () => {
          const auth = await requireNodeMutationAccess(deps, {
            headers,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`
          })
          await writeNodeAudit(deps, {
            actor: auth.actor,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`,
            permission: auth.permission,
            correlationId: auth.correlationId,
            payload: { channel: 'join-ticket' }
          })
          const ticket = await deps.storage.createNodeTicket({ ...body, createdBy: auth.actor })
          await publishNodeTicketArtifacts(deps, {
            kind: body.kind,
            name: body.name,
            ticket: { ticketId: ticket.ticketId, expiresAt: ticket.expiresAt },
            correlationId: auth.correlationId
          })
          return toNodeJoinTicketResponse(deps.joinIngressPublicUrl, {
            ticketId: ticket.ticketId,
            ticket: ticket.ticket,
            expiresAt: ticket.expiresAt,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          })
        })
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
          name: t.String({ minLength: 1 }),
          capabilities: t.Optional(t.Array(t.String())),
          expiresInSeconds: t.Optional(t.Number({ minimum: 30, maximum: 3600 }))
        }),
        response: protectedResponse(
          t.Object({
            ticketId: t.String(),
            ticket: t.String(),
            expiresAt: t.String(),
            joinUrl: t.String(),
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          { 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Create a one-time node join ticket')
      }
    )
    .post(
      '/api/v0/nodes',
      async ({ body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.node.register', headers, async () => {
          const auth = await requireNodeMutationAccess(deps, {
            headers,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`
          })
          const requestedMode = body.mode
          assertDirectNodeRegistrationAllowed(requestedMode, auth.correlationId)
          await writeNodeAudit(deps, {
            actor: auth.actor,
            action: 'node:register',
            resource: `node:${body.kind}:${body.name}`,
            permission: auth.permission,
            correlationId: auth.correlationId
          })
          const node = await deps.storage.registerNode({
            kind: body.kind,
            name: body.name,
            ...(body.capabilities ? { capabilities: body.capabilities } : {}),
            ...(requestedMode === 'simulated' ? { mode: 'simulated' as const } : {})
          })
          await publishNodeRegistrationArtifacts(deps, { node, correlationId: auth.correlationId })
          return { node, policyDecisionId: auth.permission.id, correlationId: auth.correlationId }
        })
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
          name: t.String({ minLength: 1 }),
          mode: t.Optional(t.Union([t.Literal('agent'), t.Literal('simulated')])),
          capabilities: t.Optional(t.Array(t.String()))
        }),
        response: protectedResponse(
          t.Object({ node: nodeSchema, policyDecisionId: t.String(), correlationId: t.String() }),
          { 409: apiErrorSchema, 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Register Stem or Leaf node')
      }
    )
    .post(
      '/api/v0/nodes/:id/credentials',
      async ({ params, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.node.issue-token', headers, async () => {
          const auth = await requireNodeMutationAccess(deps, {
            headers,
            action: 'node:issue-token',
            resource: `node:${params.id}`
          })
          await writeNodeAudit(deps, {
            actor: auth.actor,
            action: 'node:issue-token',
            resource: `node:${params.id}`,
            permission: auth.permission,
            correlationId: auth.correlationId
          })
          const credential = requireNodeCredential(
            await deps.storage.issueNodeCredential(params.id),
            auth.correlationId
          )
          await deps.log.writeTimeline({
            summary: `issued node token for ${params.id}`,
            subject: params.id,
            correlationId: auth.correlationId
          })
          return {
            nodeId: credential.nodeId,
            token: credential.token,
            issuedAt: credential.issuedAt,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(
          t.Object({
            nodeId: t.String(),
            token: t.String(),
            issuedAt: t.String(),
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          { 404: apiErrorSchema, 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Issue a node credential')
      }
    )
    .get(
      '/api/v0/nodes',
      async ({ headers, status: _status }) => {
        await requireNodeReadAccess(deps, headers, 'nodes')
        return { nodes: await deps.storage.listNodes() }
      },
      {
        response: protectedResponse(t.Object({ nodes: t.Array(nodeSchema) })),
        detail: protectedRouteDetail('List nodes')
      }
    )
    .get(
      '/api/v0/nodes/:id',
      async ({ params, headers, status: _status }) => {
        const auth = await requireNodeReadAccess(deps, headers, `node:${params.id}`)
        const node = await deps.storage.getNode(params.id)
        if (!node) throw new CoreError(404, 'node.not_found', 'node not found', auth.correlationId)
        return { node }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(t.Object({ node: nodeSchema }), { 404: apiErrorSchema }),
        detail: protectedRouteDetail('Read one node')
      }
    )
}
