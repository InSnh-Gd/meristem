import { Elysia, t } from 'elysia'
import { CoreError } from '../core-error.ts'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent, joinSessionUrl } from '../middleware/helpers.ts'
import {
  apiErrorSchema,
  nodeSchema,
  protectedRouteDetail,
  protectedResponse
} from '../schemas.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'

export function nodesRoutes(deps: CoreDeps) {
  return new Elysia()
    .post('/api/v0/node-tickets', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.node.ticket.create', headers, async () => {
        const auth = await requireActor(deps, headers)
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'node:register', resource: `node:${body.kind}:${body.name}`, correlationId: auth.correlationId },
        )
        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'node:register',
          resource: `node:${body.kind}:${body.name}`,
          decisionId: permission.id,
          result: permission.result,
          correlationId: auth.correlationId,
          payload: { channel: 'join-ticket' }
        })
        if (!audit.ok) throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)
        await deps.events.publish(
          'node.registration.requested.v0',
          tracedEvent({
            type: 'node.registration.requested',
            source: 'meristem-core',
            payload: { kind: body.kind, name: body.name, channel: 'join-ticket' },
            correlationId: auth.correlationId
          })
        )
        const ticket = await deps.storage.createNodeTicket({ ...body, createdBy: auth.actor })
        await deps.events.publish(
          'node.join-ticket.created.v0',
          tracedEvent({
            type: 'node.join-ticket.created',
            source: 'meristem-core',
            payload: { ticketId: ticket.ticketId, kind: body.kind, name: body.name, expiresAt: ticket.expiresAt },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `created join ticket for ${body.kind} node ${body.name}`,
          subject: ticket.ticketId,
          correlationId: auth.correlationId
        })
        return {
          ticketId: ticket.ticketId,
          ticket: ticket.ticket,
          expiresAt: ticket.expiresAt,
          joinUrl: joinSessionUrl(deps.joinIngressPublicUrl),
          policyDecisionId: permission.id,
          correlationId: auth.correlationId
        }
      })
    }, {
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
    })
    .post('/api/v0/nodes', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.node.register', headers, async () => {
        const auth = await requireActor(deps, headers)
        const requestedMode = Reflect.get(body as object, 'mode')
        if (requestedMode === 'agent') {
          throw new CoreError(409, 'node.agent_join_ticket_required', 'agent nodes must join through node ticket create and the M-Net join ingress', auth.correlationId)
        }
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'node:register', resource: `node:${body.kind}:${body.name}`, correlationId: auth.correlationId },
        )
        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'node:register',
          resource: `node:${body.kind}:${body.name}`,
          decisionId: permission.id,
          result: permission.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)
        await deps.events.publish(
          'node.registration.requested.v0',
          tracedEvent({
            type: 'node.registration.requested',
            source: 'meristem-core',
            payload: { kind: body.kind, name: body.name },
            correlationId: auth.correlationId
          })
        )
        const node = await deps.storage.registerNode({
          kind: body.kind,
          name: body.name,
          ...(body.capabilities ? { capabilities: body.capabilities } : {}),
          ...(requestedMode === 'simulated' ? { mode: 'simulated' as const } : {})
        })
        await deps.events.publish(
          'node.registration.accepted.v0',
          tracedEvent({
            type: 'node.registration.accepted',
            source: 'meristem-core',
            payload: { nodeId: node.id, kind: node.kind, mode: node.mode },
            correlationId: auth.correlationId
          })
        )
        if (node.status !== 'joining') {
          await deps.events.publish(
            'node.status.changed.v0',
            tracedEvent({
              type: 'node.status.changed',
              source: 'meristem-core',
              payload: { nodeId: node.id, previousStatus: 'joining', nextStatus: node.status },
              correlationId: auth.correlationId
            })
          )
        }
        await deps.log.writeTimeline({
          summary: `registered ${node.kind} node ${node.name}`,
          subject: node.id,
          correlationId: auth.correlationId
        })
        return { node, policyDecisionId: permission.id, correlationId: auth.correlationId }
      })
    }, {
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
    })
    .post('/api/v0/nodes/:id/credentials', async ({ params, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.node.issue-token', headers, async () => {
        const auth = await requireActor(deps, headers)
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'node:issue-token', resource: `node:${params.id}`, correlationId: auth.correlationId },
        )
        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'node:issue-token',
          resource: `node:${params.id}`,
          decisionId: permission.id,
          result: permission.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)
        const credential = await deps.storage.issueNodeCredential(params.id)
        if (!credential) throw new CoreError(404, 'node.not_found', 'node not found', auth.correlationId)
        await deps.log.writeTimeline({
          summary: `issued node token for ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })
        return {
          nodeId: credential.nodeId,
          token: credential.token,
          issuedAt: credential.issuedAt,
          policyDecisionId: permission.id,
          correlationId: auth.correlationId
        }
      })
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(
        t.Object({ nodeId: t.String(), token: t.String(), issuedAt: t.String(), policyDecisionId: t.String(), correlationId: t.String() }),
        { 404: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Issue a node credential')
    })
    .get('/api/v0/nodes', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers)
      const permission = await authorize(deps, { actor: auth.actor, action: 'core:read', resource: 'nodes', correlationId: auth.correlationId })
      return { nodes: await deps.storage.listNodes() }
    }, {
      response: protectedResponse(t.Object({ nodes: t.Array(nodeSchema) })),
      detail: protectedRouteDetail('List nodes')
    })
    .get('/api/v0/nodes/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers)
      const permission = await authorize(deps, { actor: auth.actor, action: 'core:read', resource: `node:${params.id}`, correlationId: auth.correlationId })
      const node = await deps.storage.getNode(params.id)
      if (!node) throw new CoreError(404, 'node.not_found', 'node not found', auth.correlationId)
      return { node }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(t.Object({ node: nodeSchema }), { 404: apiErrorSchema }),
      detail: protectedRouteDetail('Read one node')
    })
}
