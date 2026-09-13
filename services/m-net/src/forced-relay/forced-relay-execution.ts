import type { MNetForcedRelayChangeEventPayloadFromSchema } from '../../../../packages/contracts/src/index.ts'
import {
  type ProfileWorkflowFailure,
  profileWorkflowFailure
} from '../profile/profile-workflow-types.ts'
import { newUuid, normalizeReason } from './forced-relay-compatibility.ts'
import { resolveForcedRelayTarget } from './forced-relay-target.ts'
import {
  FORCED_RELAY_ACTION,
  type ForcedRelayCommandResult,
  type ForcedRelayExecuteDeps
} from './forced-relay-types.ts'

/** 执行强制 Relay 的策略、审计与 typed operational event proof path。 */
export async function executeForcedRelayChange(
  deps: ForcedRelayExecuteDeps,
  input: {
    actor: string
    body: { nodeId: string; reason?: string }
    correlationIdFactory?: () => string
    auditIdFactory?: () => string
    eventIdFactory?: () => string
  }
): Promise<ForcedRelayCommandResult | ProfileWorkflowFailure> {
  const resolved = await resolveForcedRelayTarget(deps, input.body.nodeId)
  if ('kind' in resolved) return resolved
  if (!deps.policyAuthorize || !deps.log || !deps.ingestOperationalEvent)
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'forced relay execute path is not available'
    )
  const resource = `network/${resolved.networkId}/node/${resolved.node.nodeId}`
  const policyDecision = await deps.policyAuthorize.authorize(
    input.actor,
    FORCED_RELAY_ACTION,
    resource
  )
  if (policyDecision.result !== 'allow') {
    const denyCorrelationId = (input.correlationIdFactory ?? newUuid)()
    await deps.log.writeAudit(
      input.actor,
      'mnet.forced-relay.change',
      resource,
      'deny',
      denyCorrelationId,
      {
        nodeId: resolved.node.nodeId,
        networkId: resolved.networkId,
        policyDecisionId: policyDecision.id,
        reasons: [...policyDecision.reasons]
      }
    )
    return profileWorkflowFailure(
      403,
      'policy.denied',
      `forced relay denied: ${policyDecision.reasons.join(', ')}`
    )
  }
  const correlationId = (input.correlationIdFactory ?? newUuid)().trim()
  if (correlationId.length === 0)
    return profileWorkflowFailure(
      503,
      'audit.correlation_missing',
      'forced relay execution requires an audit correlation id'
    )
  const auditId = (input.auditIdFactory ?? newUuid)().trim()
  const eventId = (input.eventIdFactory ?? newUuid)().trim()
  if (auditId.length === 0 || eventId.length === 0)
    return profileWorkflowFailure(
      503,
      'audit.correlation_missing',
      'forced relay execution requires audit and event identifiers'
    )
  const reason = normalizeReason(input.body.reason)
  const eventPayload: MNetForcedRelayChangeEventPayloadFromSchema = {
    networkId: resolved.networkId,
    profileVersion: 'm-net-cn@0.3.0',
    routeClass: 'forced-tcp-relay',
    selectorOwnership: 'operator',
    selector: { selectorType: 'node-ids', nodeIds: [resolved.node.nodeId] },
    operatorOverrideActive: true,
    policyDecisionId: policyDecision.id,
    auditId,
    eventId,
    affectedNodeIds: [resolved.node.nodeId],
    correlationId
  }
  await deps.log.writeAudit(
    input.actor,
    'mnet.forced-relay.change',
    resource,
    'pending',
    correlationId,
    {
      auditId,
      eventId,
      nodeId: resolved.node.nodeId,
      networkId: resolved.networkId,
      policyDecisionId: policyDecision.id,
      reason
    }
  )
  await deps.log.writeFull('info', 'Applying forced relay change', correlationId, {
    auditId,
    eventId,
    nodeId: resolved.node.nodeId,
    networkId: resolved.networkId,
    reason
  })
  const ingestResult = await deps.ingestOperationalEvent({
    networkId: resolved.networkId,
    eventId,
    occurredAt: new Date().toISOString(),
    event: { subject: 'mnet.forced_relay.change.v0', payload: eventPayload }
  })
  if ('kind' in ingestResult)
    return profileWorkflowFailure(
      ingestResult.status,
      ingestResult.error.code,
      ingestResult.error.message
    )
  await deps.log.writeTimeline(
    `Forced relay pinned to ${resolved.node.nodeId} on ${resolved.networkId}`,
    resource,
    correlationId
  )
  await deps.log.writeAudit(
    input.actor,
    'mnet.forced-relay.change',
    resource,
    'success',
    correlationId,
    {
      auditId,
      eventId,
      nodeId: resolved.node.nodeId,
      networkId: resolved.networkId,
      policyDecisionId: policyDecision.id,
      publishStatus: ingestResult.publishStatus,
      snapshotStatus: ingestResult.snapshotStatus,
      reason
    }
  )
  return {
    status: 'applied',
    networkId: resolved.networkId,
    nodeId: resolved.node.nodeId,
    profileVersion: 'm-net-cn@0.3.0',
    routeClass: 'forced-tcp-relay',
    selectorOwnership: 'operator',
    affectedNodeIds: [resolved.node.nodeId],
    policyDecisionId: policyDecision.id,
    auditId,
    eventId,
    correlationId,
    publishStatus: ingestResult.publishStatus,
    snapshotStatus: ingestResult.snapshotStatus
  }
}
