import type {
  CommandWellEligibilityFromSchema,
  MNetForcedRelayChangeEventPayloadFromSchema,
  MNetMigrationRequiredFromSchema,
  MNetOperationalEventIngestResponseFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  isReachable,
  nodeCompatibility,
  profileCompatibility
} from './forced-relay-compatibility.ts'
import type { ForcedRelayNodeContext } from './forced-relay-node-context.ts'
import { isMigrationRequiredFailure } from './migration-required-support.ts'
import { authorizeOr403 } from './policy-guard.ts'
import { type ProfileWorkflowFailure, profileWorkflowFailure } from './profile-workflow-types.ts'

const FORCED_RELAY_COMMAND_ID = 'network.forced-relay.change.execute'
const FORCED_RELAY_LABEL = '切换强制 Relay 类'
const FORCED_RELAY_ACTION = 'network:profile-enable'

export type ForcedRelayEligibilityDeps = Pick<
  MNetAppDeps,
  'profileStore' | 'describeForcedRelayNode'
>

export type ForcedRelayExecuteDeps = Pick<
  MNetAppDeps,
  'profileStore' | 'policyAuthorize' | 'log' | 'ingestOperationalEvent' | 'describeForcedRelayNode'
>

export type ForcedRelayExecuteBody = {
  nodeId: string
  reason?: string
}

export type ForcedRelayCommandResult = {
  status: 'applied'
  networkId: string
  nodeId: string
  profileVersion: 'm-net-cn@0.3.0'
  routeClass: 'forced-tcp-relay'
  selectorOwnership: 'operator'
  affectedNodeIds: string[]
  policyDecisionId: string
  auditId: string
  eventId: string
  correlationId: string
  publishStatus: MNetOperationalEventIngestResponseFromSchema['publishStatus']
  snapshotStatus: MNetOperationalEventIngestResponseFromSchema['snapshotStatus']
}

type ResolvedForcedRelayTarget = {
  node: ForcedRelayNodeContext
  networkId: string
  profileVersion: 'm-net-cn@0.3.0'
}

type ForcedRelayDisabledCode =
  | 'missing_permission'
  | 'target_missing'
  | 'wrong_node_kind'
  | 'unreachable_node'
  | 'migration_required'

function forcedRelayCommand(
  resource: string
): Extract<CommandWellEligibilityFromSchema, { state: 'enabled' }>['command'] {
  return {
    id: FORCED_RELAY_COMMAND_ID,
    label: FORCED_RELAY_LABEL,
    action: FORCED_RELAY_ACTION,
    resource,
    risk: 'high',
    requiredPermissions: [FORCED_RELAY_ACTION],
    requiresPolicy: true,
    requiresAudit: true
  }
}

function disabledEligibility(
  code: ForcedRelayDisabledCode,
  message: string,
  migration?: MNetMigrationRequiredFromSchema
): Extract<CommandWellEligibilityFromSchema, { state: 'disabled' }> {
  return {
    state: 'disabled',
    disabled: {
      code,
      message,
      ...(migration ? { migration } : {})
    },
    disabledReason: message
  }
}

function asMigrationFailure(
  migration: MNetMigrationRequiredFromSchema,
  status: ProfileWorkflowFailure['status'] = 409
): ProfileWorkflowFailure {
  return {
    kind: 'failure',
    ok: false,
    status,
    error: {
      code: 'migration_required',
      message: migration.message,
      migration
    }
  }
}

function normalizeReason(reason: string | undefined): string {
  return reason && reason.trim().length > 0 ? reason.trim() : 'forced relay change from CommandWell'
}

function newUuid(): string {
  return globalThis.crypto.randomUUID()
}

async function resolveForcedRelayTarget(
  deps: Pick<MNetAppDeps, 'profileStore' | 'describeForcedRelayNode'>,
  nodeId: string
): Promise<ResolvedForcedRelayTarget | ProfileWorkflowFailure> {
  if (!deps.profileStore || !deps.describeForcedRelayNode) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'forced relay workflow is not available'
    )
  }

  const node = await deps.describeForcedRelayNode(nodeId)
  if (!node) {
    return profileWorkflowFailure(404, 'node.not_found', 'node not found')
  }
  if (!node.networkId || !node.networkProfileVersion) {
    return profileWorkflowFailure(404, 'node.not_in_network', 'node is not joined to a network')
  }
  if (node.nodeKind !== 'leaf') {
    return profileWorkflowFailure(
      409,
      'forced_relay.wrong_node_kind',
      'forced relay change requires a Leaf node'
    )
  }
  if (!isReachable(node)) {
    return profileWorkflowFailure(
      409,
      'forced_relay.node_unreachable',
      'selected node is not reachable'
    )
  }

  const networkState = await deps.profileStore.getNetworkState(node.networkId)
  if (!networkState) {
    return profileWorkflowFailure(404, 'network.not_found', 'network not found')
  }

  const compatibility = profileCompatibility(networkState.profileVersion)
  if (!compatibility) {
    return profileWorkflowFailure(
      409,
      'forced_relay.unsupported_profile',
      'forced relay change requires an m-net-cn@0.3.0 profile'
    )
  }
  if (compatibility.kind === 'migration_required') {
    return asMigrationFailure(compatibility.migration)
  }
  if (compatibility.profile.profileVersion !== 'm-net-cn@0.3.0') {
    return profileWorkflowFailure(
      409,
      'forced_relay.unsupported_profile',
      'forced relay change requires an m-net-cn@0.3.0 profile'
    )
  }

  const nodeRuntimeCompatibility = nodeCompatibility(node)
  if (nodeRuntimeCompatibility.kind === 'migration_required') {
    return asMigrationFailure(nodeRuntimeCompatibility.migration)
  }

  return {
    node,
    networkId: node.networkId,
    profileVersion: 'm-net-cn@0.3.0'
  }
}

/**
 * CommandWell eligibility 只基于公开事实判断展示态，不提前执行 M-Policy。
 */
export async function deriveForcedRelayEligibility(
  deps: ForcedRelayEligibilityDeps,
  input: { nodeId: string }
): Promise<CommandWellEligibilityFromSchema> {
  const resolved = await resolveForcedRelayTarget(deps, input.nodeId)
  if ('kind' in resolved) {
    if (resolved.status === 404) {
      return disabledEligibility('target_missing', resolved.error.message)
    }
    if (isMigrationRequiredFailure(resolved)) {
      return disabledEligibility(
        'migration_required',
        resolved.error.message,
        resolved.error.migration
      )
    }
    if (resolved.error.code === 'forced_relay.wrong_node_kind') {
      return disabledEligibility('wrong_node_kind', '目标不是 Leaf 节点')
    }
    if (resolved.error.code === 'forced_relay.node_unreachable') {
      return disabledEligibility('unreachable_node', '目标节点不可达')
    }
    return disabledEligibility('wrong_node_kind', resolved.error.message)
  }

  return {
    state: 'enabled',
    command: forcedRelayCommand(`network/${resolved.networkId}/node/${resolved.node.nodeId}`)
  }
}

/**
 * 高风险 forced relay proof path 先过策略、先落审计相关事实，再发布 typed event；任一步骤失败都 fail-closed。
 */
export async function executeForcedRelayChange(
  deps: ForcedRelayExecuteDeps,
  input: {
    actor: string
    body: ForcedRelayExecuteBody
    correlationIdFactory?: () => string
    auditIdFactory?: () => string
    eventIdFactory?: () => string
  }
): Promise<ForcedRelayCommandResult | ProfileWorkflowFailure> {
  const resolved = await resolveForcedRelayTarget(deps, input.body.nodeId)
  if ('kind' in resolved) return resolved

  if (!deps.policyAuthorize || !deps.log || !deps.ingestOperationalEvent) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'forced relay execute path is not available'
    )
  }

  const resource = `network/${resolved.networkId}/node/${resolved.node.nodeId}`
  const policyGuard = await authorizeOr403(deps.policyAuthorize, {
    actor: input.actor,
    action: FORCED_RELAY_ACTION,
    resource,
    deniedPrefix: 'forced relay',
    denyOn: 'non-allow'
  })
  if (policyGuard.kind === 'denied') {
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
        policyDecisionId: policyGuard.policyDecisionId,
        reasons: [...policyGuard.reasons]
      }
    )
    return profileWorkflowFailure(policyGuard.status, policyGuard.code, policyGuard.message)
  }

  const correlationId = (input.correlationIdFactory ?? newUuid)().trim()
  if (correlationId.length === 0) {
    return profileWorkflowFailure(
      503,
      'audit.correlation_missing',
      'forced relay execution requires an audit correlation id'
    )
  }

  const auditId = (input.auditIdFactory ?? newUuid)().trim()
  const eventId = (input.eventIdFactory ?? newUuid)().trim()
  if (auditId.length === 0 || eventId.length === 0) {
    return profileWorkflowFailure(
      503,
      'audit.correlation_missing',
      'forced relay execution requires audit and event identifiers'
    )
  }

  const reason = normalizeReason(input.body.reason)
  const eventPayload: MNetForcedRelayChangeEventPayloadFromSchema = {
    networkId: resolved.networkId,
    profileVersion: 'm-net-cn@0.3.0',
    routeClass: 'forced-tcp-relay',
    selectorOwnership: 'operator',
    selector: {
      selectorType: 'node-ids',
      nodeIds: [resolved.node.nodeId]
    },
    operatorOverrideActive: true,
    policyDecisionId: policyGuard.policyDecisionId,
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
      policyDecisionId: policyGuard.policyDecisionId,
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
    event: {
      subject: 'mnet.forced_relay.change.v0',
      payload: eventPayload
    }
  })
  if ('kind' in ingestResult) {
    return profileWorkflowFailure(
      ingestResult.status,
      ingestResult.error.code,
      ingestResult.error.message
    )
  }

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
      policyDecisionId: policyGuard.policyDecisionId,
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
    policyDecisionId: policyGuard.policyDecisionId,
    auditId,
    eventId,
    correlationId,
    publishStatus: ingestResult.publishStatus,
    snapshotStatus: ingestResult.snapshotStatus
  }
}
