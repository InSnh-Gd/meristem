import type {
  ActorId,
  MNetForcedRelayPolicyResultFromSchema,
  MNetNodeSelectorFromSchema,
  MNetOperationDeniedFromSchema,
  MNetRouteClassFromSchema,
  MNetSidecarStatusFromSchema,
  MNetTopologyViewFromSchema,
  MNetTunnelHealthFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { ClosedLoopWorkflowContext } from './closed-loop-workflow-support.ts'
import { closedLoopFailure, closedLoopFailureFromUnknown } from './closed-loop-workflow-support.ts'
import type { ClosedLoopFailure, ClosedLoopMutationOutcome } from './closed-loop-workflow-types.ts'

function missingSidecarStatus(nodeId: string, checkedAt: string): MNetSidecarStatusFromSchema {
  return {
    nodeId,
    desiredState: 'start',
    healthStatus: 'unhealthy',
    degradedReason: 'missing_signal',
    proofPath: 'operator-report',
    uiFacingFact: true,
    healthy: false,
    checkedAt
  }
}

/** 聚合拓扑事实，并承载 forced-relay 的策略、Audit 与事件时序。 */
export function createTopologyWorkflow(context: ClosedLoopWorkflowContext) {
  const {
    deps,
    id,
    now,
    timestamp,
    authorizeAndAudit,
    authorizeRead,
    commitMutation,
    publishFacts
  } = context

  async function changeRelayPolicy(input: {
    actor: ActorId
    networkId: string
    state: 'enabled' | 'disabled'
    routeClass: MNetRouteClassFromSchema
    selector: MNetNodeSelectorFromSchema
    reason: string
    affectedNodeIds: string[]
  }): Promise<
    | ClosedLoopMutationOutcome<
        Exclude<MNetForcedRelayPolicyResultFromSchema, MNetOperationDeniedFromSchema>
      >
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: input.state === 'enabled' ? 'network:profile-enable' : 'network:profile-disable',
      auditAction:
        input.state === 'enabled' ? 'mnet.relay_policy.enable' : 'mnet.relay_policy.disable',
      resource: `network:${input.networkId}:relay-policy`,
      correlationId,
      payload: { state: input.state, reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated
    const result: Exclude<MNetForcedRelayPolicyResultFromSchema, MNetOperationDeniedFromSchema> = {
      result: input.state,
      relayPolicyId: id('relay-policy'),
      networkId: input.networkId,
      state: input.state,
      routeClass: input.routeClass,
      selector: input.selector,
      reason: input.reason,
      affectedNodeIds: input.affectedNodeIds,
      evidence: gated.evidence,
      correlationId
    }
    try {
      return await commitMutation({
        networkId: input.networkId,
        correlationId,
        mutationKind: 'relay-policy-changed',
        value: result,
        facts: [{ kind: 'relay-policy', value: result }],
        events: [{ subject: 'mnet.relay_policy.changed.v0', payload: result }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function recordSidecarStatus(input: {
    networkId: string
    status: MNetSidecarStatusFromSchema
  }): Promise<ClosedLoopMutationOutcome<MNetSidecarStatusFromSchema> | ClosedLoopFailure> {
    const correlationId = id('correlation')
    try {
      return await commitMutation({
        networkId: input.networkId,
        correlationId,
        mutationKind: 'sidecar-status-recorded',
        value: input.status,
        facts: [{ kind: 'sidecar', networkId: input.networkId, value: input.status }],
        events: input.status.healthy
          ? []
          : [{ subject: 'mnet.sidecar.degraded.v0', payload: input.status }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function recordTunnelHealth(input: {
    networkId: string
    health: MNetTunnelHealthFromSchema
  }): Promise<ClosedLoopMutationOutcome<MNetTunnelHealthFromSchema> | ClosedLoopFailure> {
    const correlationId = id('correlation')
    try {
      return await commitMutation({
        networkId: input.networkId,
        correlationId,
        mutationKind: 'tunnel-health-recorded',
        value: input.health,
        facts: [{ kind: 'tunnel', networkId: input.networkId, value: input.health }],
        events: [{ subject: 'mnet.tunnel.health.v0', payload: input.health }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function getTopologyView(input: {
    actor: ActorId
    networkId: string
    correlationId: string
  }): Promise<MNetTopologyViewFromSchema | ClosedLoopFailure> {
    const denied = await authorizeRead({
      actor: input.actor,
      permission: 'network:read',
      resource: `network:${input.networkId}:topology`
    })
    if (denied) return denied
    const networksResult = await deps.network.listNetworks()
    if (!networksResult.ok) {
      return closedLoopFailure(503, networksResult.error.code, networksResult.error.message)
    }
    const network = networksResult.value.find(candidate => candidate.id === input.networkId)
    if (!network) return closedLoopFailure(404, 'mnet.network.not_found', 'network not found')
    if (network.profileVersion !== 'm-net@0.3.0' && network.profileVersion !== 'm-net-cn@0.3.0') {
      return closedLoopFailure(
        409,
        'mnet.profile.migration_required',
        'network profile requires migration'
      )
    }
    const membersResult = await deps.network.listMembers({ networkId: input.networkId })
    if (!membersResult.ok) {
      return closedLoopFailure(503, membersResult.error.code, membersResult.error.message)
    }
    const map = await deps.dataPlane.networkMaps.getLatest(input.networkId)
    if (!map) {
      return closedLoopFailure(404, 'mnet.topology.map_missing', 'signed topology map not found')
    }
    const sidecars = await deps.store.sidecars.listByNetwork(input.networkId)
    const tunnels = await deps.store.tunnels.listByNetwork(input.networkId)
    const credentials = await deps.store.credentials.listByNetwork(input.networkId)
    const relayPolicy = await deps.store.relayPolicies.get(input.networkId)
    const observedAt = timestamp()
    const expired = Date.parse(map.expiresAt) <= now().getTime()
    const mapStatus: MNetTopologyViewFromSchema['networks'][number]['mapStatus'] = {
      mapId: `${map.networkId}:${map.mapVersion}`,
      networkId: map.networkId,
      topologyRevision: String(map.mapVersion),
      signedBy: map.map.signatureMetadata.keyId,
      issuedAt: map.publishedAt,
      expiresAt: map.expiresAt,
      freshness: expired ? 'expired' : 'fresh',
      stateSource: 'nats-kv-cache',
      validation: expired ? 'expired' : 'valid'
    }
    const nodes: Array<MNetTopologyViewFromSchema['nodes'][number]> = []
    for (const member of membersResult.value) {
      const sidecar =
        sidecars.find(candidate => candidate.nodeId === member.nodeId) ??
        missingSidecarStatus(member.nodeId, observedAt)
      const credential = credentials
        .filter(candidate => candidate.nodeId === member.nodeId)
        .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))[0]
      const keys = await deps.dataPlane.nodePublicKeys.listByNode(member.nodeId)
      const key = keys.sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
      )[0]
      nodes.push({
        nodeId: member.nodeId,
        nodeKind: member.nodeKind,
        runtimeState: sidecar.healthy ? 'healthy' : 'degraded',
        profileVersion: network.profileVersion,
        sidecar,
        credentialStatus: credential?.status ?? 'pending',
        keyStatus: key
          ? {
              nodeId: member.nodeId,
              publicKeyFingerprint: key.fingerprint,
              status:
                key.status === 'revoked'
                  ? 'revoked'
                  : key.status === 'rotation_required'
                    ? 'rotation_required'
                    : 'registered',
              lastValidatedAt: key.rotatedAt ?? key.createdAt
            }
          : {
              nodeId: member.nodeId,
              publicKeyFingerprint: 'unregistered',
              status: 'stale',
              lastValidatedAt: observedAt
            }
      })
    }
    const degraded =
      expired ||
      nodes.some(node => !node.sidecar.healthy) ||
      tunnels.some(tunnel => tunnel.status !== 'up')
    const topology: MNetTopologyViewFromSchema = {
      contractVersion: 'mnet-closed-loop@0.1.0',
      generatedAt: observedAt,
      stateSource: 'composed-ui-fact',
      networks: [
        {
          networkId: network.id,
          displayName: network.name,
          profileVersion: network.profileVersion,
          status: expired ? 'fail_closed' : degraded ? 'degraded' : 'healthy',
          mapStatus,
          relayPolicyState: relayPolicy?.state ?? 'disabled'
        }
      ],
      nodes,
      profiles: [network.profileVersion],
      tunnelHealth: tunnels,
      sidecarStatuses: nodes.map(node => node.sidecar),
      degraded,
      correlationId: input.correlationId
    }
    await publishFacts({
      networkId: input.networkId,
      correlationId: input.correlationId,
      events: [
        { subject: 'mnet.topology.map.status.v0', payload: mapStatus },
        { subject: 'mnet.topology.view.updated.v0', payload: topology }
      ]
    })
    return topology
  }

  return { changeRelayPolicy, recordSidecarStatus, recordTunnelHealth, getTopologyView }
}
