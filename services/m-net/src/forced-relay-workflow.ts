import type {
  CommandWellEligibilityFromSchema,
  MNetForcedRelayChangeEventPayloadFromSchema,
  MNetOperationalEventIngestResponseFromSchema,
  MNetProfileV03CompatibilityResultFromSchema,
  MNetNodeV03CompatibilityResultFromSchema,
  MNetMigrationRequiredFromSchema
} from '../../../packages/contracts/src/index.ts'
import {
  decodeMNetNodeV03Compatibility,
  decodeMNetProfileV03Compatibility
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import type { ForcedRelayNodeContext } from './forced-relay-node-context.ts'
import {
  profileWorkflowFailure,
  type ProfileWorkflowFailure
} from './profile-workflow-types.ts'
import {
  isMigrationRequiredFailure
} from './migration-required-support.ts'

const FORCED_RELAY_COMMAND_ID = 'network.forced-relay.change.execute'
const FORCED_RELAY_LABEL = '切换强制 Relay 类'
const FORCED_RELAY_ACTION = 'network:profile-enable'
const LEGACY_NODE_AGENT_CAPABILITY = 'node-agent.wstunnel.v0.2'

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

function forcedRelayCommand(resource: string): Extract<
  CommandWellEligibilityFromSchema,
  { state: 'enabled' }
>['command'] {
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

function isReachable(node: ForcedRelayNodeContext): boolean {
  return node.reachability === 'reachable' || node.reachability === 'public'
}

function profileCompatibility(
  profileVersion: string
): MNetProfileV03CompatibilityResultFromSchema | null {
  if (profileVersion === 'm-net-cn@0.3.0') {
    return {
      kind: 'profile',
      profile: {
        profileVersion: 'm-net-cn@0.3.0',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'cn',
        displayName: 'CN profile',
        status: 'available',
        capabilities: {
          controlPlaneOnly: false,
          managementPlaneExcluded: true,
          realNetBirdSidecar: true,
          signalConfigRef: { configRef: 'signal/cn-primary' },
          relayConfigRef: { configRef: 'relay/cn-primary' },
          stunConfigRef: { configRef: 'stun/cn-primary' },
          sidecarDesiredState: 'start',
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/cn-sidecar',
            version: 1
          },
          sidecarCredentialStatus: 'ready',
          sidecarHealthStatus: 'healthy'
        },
        forcedTcpRelaySelector: {
          enabled: true,
          selectorOwnership: 'operator',
          selector: {
            selectorType: 'node-ids',
            nodeIds: ['bootstrap-cn-leaf']
          },
          routeClass: 'forced-tcp-relay',
          operatorOverrideAllowed: true,
          operatorOverrideActive: false,
          policyDecision: {
            decisionId: 'bootstrap-policy-decision',
            source: 'm-policy',
            outcome: 'allow',
            reason: 'bootstrap compatibility fixture'
          },
          auditEvidence: {
            auditId: 'bootstrap-audit-id',
            eventId: 'bootstrap-event-id',
            eventSubject: 'mnet.forced_relay.change.v0'
          }
        },
        rules: {
          transport: 'netbird-sidecar',
          mode: 'cn-sidecar',
          relay: {
            selectorMode: 'operator-override',
            defaultRouteClass: 'auto',
            forcedTcpRelay: {
              enabled: true,
              eventSubject: 'mnet.forced_relay.change.v0'
            }
          }
        }
      }
    }
  }
  if (profileVersion === 'm-net@0.3.0') {
    return {
      kind: 'profile',
      profile: {
        profileVersion: 'm-net@0.3.0',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'default',
        displayName: 'Default profile',
        status: 'available',
        capabilities: {
          controlPlaneOnly: false,
          managementPlaneExcluded: true,
          realNetBirdSidecar: true,
          signalConfigRef: { configRef: 'signal/default-primary' },
          relayConfigRef: { configRef: 'relay/default-primary' },
          stunConfigRef: { configRef: 'stun/default-primary' },
          sidecarDesiredState: 'start',
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/default-sidecar',
            version: 1
          },
          sidecarCredentialStatus: 'ready',
          sidecarHealthStatus: 'healthy'
        },
        rules: {
          transport: 'netbird-sidecar',
          mode: 'standard',
          relay: {
            selectorMode: 'automatic',
            defaultRouteClass: 'auto'
          }
        }
      }
    }
  }

  try {
    return decodeMNetProfileV03Compatibility({ profileId: profileVersion, profileVersion })
  } catch {
    return null
  }
}

function nodeCompatibility(node: ForcedRelayNodeContext): MNetNodeV03CompatibilityResultFromSchema {
  return decodeMNetNodeV03Compatibility({
    nodeId: node.nodeId,
    profileVersion:
      node.networkProfileVersion?.startsWith('m-net-cn@') === true ? 'm-net-cn@0.3.0' : 'm-net@0.3.0',
    transport: node.capabilities.includes(LEGACY_NODE_AGENT_CAPABILITY)
      ? 'wstunnel'
      : 'netbird-sidecar'
  })
}

async function resolveForcedRelayTarget(
  deps: Pick<MNetAppDeps, 'profileStore' | 'describeForcedRelayNode'>,
  nodeId: string
): Promise<ResolvedForcedRelayTarget | ProfileWorkflowFailure> {
  if (!deps.profileStore || !deps.describeForcedRelayNode) {
    return profileWorkflowFailure(503, 'feature.unavailable', 'forced relay workflow is not available')
  }

  const node = await deps.describeForcedRelayNode(nodeId)
  if (!node) {
    return profileWorkflowFailure(404, 'node.not_found', 'node not found')
  }
  if (!node.networkId || !node.networkProfileVersion) {
    return profileWorkflowFailure(404, 'node.not_in_network', 'node is not joined to a network')
  }
  if (node.nodeKind !== 'leaf') {
    return profileWorkflowFailure(409, 'forced_relay.wrong_node_kind', 'forced relay change requires a Leaf node')
  }
  if (!isReachable(node)) {
    return profileWorkflowFailure(409, 'forced_relay.node_unreachable', 'selected node is not reachable')
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
      return disabledEligibility('migration_required', resolved.error.message, resolved.error.migration)
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
    return profileWorkflowFailure(503, 'feature.unavailable', 'forced relay execute path is not available')
  }

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
    return profileWorkflowFailure(403, 'policy.denied', `forced relay denied: ${policyDecision.reasons.join(', ')}`)
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
    policyDecisionId: policyDecision.id,
    auditId,
    eventId,
    affectedNodeIds: [resolved.node.nodeId],
    correlationId
  }

  await deps.log.writeAudit(input.actor, 'mnet.forced-relay.change', resource, 'pending', correlationId, {
    auditId,
    eventId,
    nodeId: resolved.node.nodeId,
    networkId: resolved.networkId,
    policyDecisionId: policyDecision.id,
    reason
  })
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
    return profileWorkflowFailure(ingestResult.status, ingestResult.error.code, ingestResult.error.message)
  }

  await deps.log.writeTimeline(
    `Forced relay pinned to ${resolved.node.nodeId} on ${resolved.networkId}`,
    resource,
    correlationId
  )
  await deps.log.writeAudit(input.actor, 'mnet.forced-relay.change', resource, 'success', correlationId, {
    auditId,
    eventId,
    nodeId: resolved.node.nodeId,
    networkId: resolved.networkId,
    policyDecisionId: policyDecision.id,
    publishStatus: ingestResult.publishStatus,
    snapshotStatus: ingestResult.snapshotStatus,
    reason
  })

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
