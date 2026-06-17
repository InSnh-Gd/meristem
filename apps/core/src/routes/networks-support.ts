import type { ActorId, PolicyDecision } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

type NetworkMutationAuth = Awaited<ReturnType<typeof requireActor>> & { permission: PolicyDecision }

export async function requireNetworkReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  resource: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'network:read',
    resource,
    correlationId: auth.correlationId
  })
  return auth
}

export async function requireNetworkMutationAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: 'network:create' | 'network:join'
    resource: string
  }
): Promise<NetworkMutationAuth> {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return { ...auth, permission }
}

export async function writeNetworkAuditOrThrow(
  deps: CoreDeps,
  input: {
    actor: ActorId
    action: 'network:create' | 'network:join'
    resource: string
    permission: PolicyDecision
    correlationId: string
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.permission.id,
    result: input.permission.result,
    correlationId: input.correlationId
  })
  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function unwrapNetworkResult<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  correlationId: string
): T {
  if (!result.ok) {
    throw new CoreError(
      statusCodeForServiceError(result.error.code),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

export async function publishNetworkCreatedArtifacts(
  deps: CoreDeps,
  created: { id: string; name: string; profileVersion: string },
  correlationId: string
) {
  await deps.events.publish(
    'mnet.network.created.v0',
    tracedEvent({
      type: 'mnet.network.created',
      source: 'meristem-core',
      payload: {
        networkId: created.id,
        name: created.name,
        profileVersion: created.profileVersion
      },
      correlationId
    })
  )
  await deps.log.writeTimeline({
    summary: `created network ${created.name}`,
    subject: created.id,
    correlationId
  })
}

export async function publishNetworkJoinedArtifacts(
  deps: CoreDeps,
  member: {
    networkId: string
    nodeId: string
    nodeKind: string
    membershipMode: string
  },
  correlationId: string
) {
  await deps.events.publish(
    'mnet.membership.joined.v0',
    tracedEvent({
      type: 'mnet.membership.joined',
      source: 'meristem-core',
      payload: {
        networkId: member.networkId,
        nodeId: member.nodeId,
        nodeKind: member.nodeKind,
        membershipMode: member.membershipMode
      },
      correlationId
    })
  )
  await deps.log.writeTimeline({
    summary: `joined node ${member.nodeId} to network ${member.networkId}`,
    subject: member.networkId,
    correlationId
  })
}
