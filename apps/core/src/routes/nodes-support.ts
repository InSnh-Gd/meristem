import type { MNode, Permission, PolicyDecision } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { joinSessionUrl, tracedEvent } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

type NodeMutationAuth = Awaited<ReturnType<typeof requireActor>> & { permission: PolicyDecision }

export async function requireNodeMutationAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Extract<
      Permission,
      'node:register' | 'node:issue-token' | 'node:switch-role' | 'node:disable' | 'node:isolate' | 'node:recover'
    >
    resource: string
  }
): Promise<NodeMutationAuth> {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return { ...auth, permission }
}

export async function requireNodeControlAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Extract<Permission, 'node:switch-role' | 'node:disable' | 'node:isolate' | 'node:recover'>
    resource: string
    requestedAction: 'disable' | 'isolate' | 'recover' | 'switch-role'
    targetKind?: 'stem' | 'leaf'
  }
): Promise<NodeMutationAuth> {
  const auth = await requireActor(deps, input.headers)
  const decision = await deps.policy.authorize({
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  if (!decision.ok) {
    throw new CoreError(503, decision.error.code, decision.error.message, auth.correlationId)
  }
  const permission = decision.value
  if (permission.result === 'deny') {
    const audit = await deps.log.writeAudit({
      actor: auth.actor,
      action: input.action,
      resource: input.resource,
      decisionId: permission.id,
      result: 'deny',
      correlationId: auth.correlationId,
      payload: {
        requestedAction: input.requestedAction,
        ...(input.targetKind ? { targetKind: input.targetKind } : {})
      }
    })
    if (!audit.ok) {
      throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)
    }
    await deps.log.writeFull({
      level: 'warn',
      source: 'meristem-core',
      message: `permission denied: ${input.action}`,
      correlationId: auth.correlationId,
      payload: {
        actor: auth.actor,
        action: input.action,
        resource: input.resource,
        decisionId: permission.id
      }
    })
    throw new CoreError(403, 'policy.denied', 'permission denied', auth.correlationId)
  }
  return { ...auth, permission }
}

export async function requireNodeReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  resource: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'core:read',
    resource,
    correlationId: auth.correlationId
  })
  return auth
}

export async function writeNodeAudit(
  deps: CoreDeps,
  input: {
    actor: NodeMutationAuth['actor']
    action: 'node:register' | 'node:issue-token'
    resource: string
    permission: PolicyDecision
    correlationId: string
    payload?: Record<string, unknown>
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.permission.id,
    result: input.permission.result,
    correlationId: input.correlationId,
    ...(input.payload ? { payload: input.payload } : {})
  })
  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function assertDirectNodeRegistrationAllowed(requestedMode: unknown, correlationId: string) {
  if (requestedMode === 'agent') {
    throw new CoreError(
      409,
      'node.agent_join_ticket_required',
      'agent nodes must join through node ticket create and the M-Net join ingress',
      correlationId
    )
  }
}

export async function publishNodeTicketArtifacts(
  deps: CoreDeps,
  input: {
    kind: 'stem' | 'leaf'
    name: string
    ticket: { ticketId: string; expiresAt: string }
    correlationId: string
  }
) {
  await deps.events.publish(
    'node.registration.requested.v0',
    tracedEvent({
      type: 'node.registration.requested',
      source: 'meristem-core',
      payload: { kind: input.kind, name: input.name, channel: 'join-ticket' },
      correlationId: input.correlationId
    })
  )
  await deps.events.publish(
    'node.join-ticket.created.v0',
    tracedEvent({
      type: 'node.join-ticket.created',
      source: 'meristem-core',
      payload: {
        ticketId: input.ticket.ticketId,
        kind: input.kind,
        name: input.name,
        expiresAt: input.ticket.expiresAt
      },
      correlationId: input.correlationId
    })
  )
  await deps.log.writeTimeline({
    summary: `created join ticket for ${input.kind} node ${input.name}`,
    subject: input.ticket.ticketId,
    correlationId: input.correlationId
  })
}

export async function publishNodeRegistrationArtifacts(
  deps: CoreDeps,
  input: { node: MNode; correlationId: string }
) {
  await deps.events.publish(
    'node.registration.accepted.v0',
    tracedEvent({
      type: 'node.registration.accepted',
      source: 'meristem-core',
      payload: { nodeId: input.node.id, kind: input.node.kind, mode: input.node.mode },
      correlationId: input.correlationId
    })
  )
  if (input.node.status !== 'joining') {
    await deps.events.publish(
      'node.status.changed.v0',
      tracedEvent({
        type: 'node.status.changed',
        source: 'meristem-core',
        payload: {
          nodeId: input.node.id,
          previousStatus: 'joining',
          nextStatus: input.node.status
        },
        correlationId: input.correlationId
      })
    )
  }
  await deps.log.writeTimeline({
    summary: `registered ${input.node.kind} node ${input.node.name}`,
    subject: input.node.id,
    correlationId: input.correlationId
  })
}

export function requireNodeCredential<
  T extends { nodeId: string }
>(credential: T | null, correlationId: string): T {
  if (!credential) {
    throw new CoreError(404, 'node.not_found', 'node not found', correlationId)
  }
  return credential
}

export function toNodeJoinTicketResponse(
  joinIngressPublicUrl: string,
  input: {
    ticketId: string
    ticket: string
    expiresAt: string
    policyDecisionId: string
    correlationId: string
  }
) {
  return {
    ticketId: input.ticketId,
    ticket: input.ticket,
    expiresAt: input.expiresAt,
    joinUrl: joinSessionUrl(joinIngressPublicUrl),
    policyDecisionId: input.policyDecisionId,
    correlationId: input.correlationId
  }
}
