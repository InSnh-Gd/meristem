import type { MNetProfileVersionFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import { validatePublicKeyMetadata } from './key-lifecycle.ts'
import {
  asFailure,
  bootstrapNodePublicKey,
  buildRequestedAclRules,
  type DataPlaneDeps,
  type LatestNetworkMapSuccess,
  type MaterializedMembers,
  selectRelayForMembers,
  toTunnelAssignments
} from './mnet-dataplane-support.ts'
import {
  decideNetworkMapEnforcement,
  renderNetworkMap,
  resolveNetworkMapStaleTtlMs
} from './network-map-renderer.ts'
import { resolveNetworkMapSigningKeyMaterial } from './network-map-signing.ts'
import { assignNodeTunnelIp, DEFAULT_MNET_OVERLAY_CIDR } from './overlay-cidr.ts'
import { transitionPartitionState } from './partition-state.ts'
import { type ProfileWorkflowFailure, profileWorkflowFailure } from './profile-workflow-types.ts'

/** 渲染并持久化成员地址、密钥、relay 与 network-map。 */
export async function materializeMembers(
  deps: DataPlaneDeps,
  networkId: string,
  profileVersion: MNetProfileVersionFromSchema,
  _correlationId: string
): Promise<ProfileWorkflowFailure | MaterializedMembers> {
  try {
    const membersResult = await deps.listMembers({ networkId })
    if (!membersResult.ok) {
      return profileWorkflowFailure(404, membersResult.error.code, membersResult.error.message)
    }
    const members = membersResult.value
    if (members.length === 0) {
      return profileWorkflowFailure(409, 'network.members_missing', 'network has no joined members')
    }

    const existingAllocations = [
      ...(await deps.dataPlane.tunnelAllocations.listByNetwork(networkId))
    ]
    const latestMap = await deps.dataPlane.networkMaps.getLatest(networkId)
    const relayAssignment = selectRelayForMembers(members)
    const relayNodeIds = members.map(member => member.nodeId)
    const renderedMembers: Array<{
      nodeId: string
      nodeKind: 'stem' | 'leaf'
      tunnelIp: string
      publicKey: string
      endpoint?: string
    }> = []

    for (const member of members) {
      const existing = existingAllocations.find(item => item.nodeId === member.nodeId)
      let resolved: { subnetCidr: string; tunnelIp: string }
      if (existing) {
        resolved = { subnetCidr: existing.subnetCidr, tunnelIp: existing.tunnelIp }
      } else {
        const assignment = assignNodeTunnelIp({
          networkId,
          nodeId: member.nodeId,
          subnetCidr: existingAllocations[0]?.subnetCidr ?? DEFAULT_MNET_OVERLAY_CIDR,
          existingAssignments: toTunnelAssignments(existingAllocations)
        })
        if (!assignment.ok) {
          return profileWorkflowFailure(
            409,
            assignment.error.kind,
            'tunnel address allocation failed'
          )
        }
        resolved = { subnetCidr: assignment.value.cidr, tunnelIp: assignment.value.tunnelIp }
        const allocationRecord = {
          networkId,
          nodeId: member.nodeId,
          subnetCidr: resolved.subnetCidr,
          tunnelIp: resolved.tunnelIp,
          allocatedAt: new Date().toISOString()
        }
        await deps.dataPlane.tunnelAllocations.upsert({
          ...allocationRecord
        })
        existingAllocations.push(allocationRecord)
      }

      const existingKeys = await deps.dataPlane.nodePublicKeys.listByNode(member.nodeId)
      const existingKey = existingKeys.at(-1)
      let publicKey = existingKey?.publicKey
      if (existingKey === undefined) {
        const bootstrappedKey = validatePublicKeyMetadata({
          nodeId: member.nodeId,
          keyId: `bootstrap-${member.nodeId}`,
          publicKey: bootstrapNodePublicKey(member.nodeId),
          createdAt: new Date().toISOString()
        })
        if (!bootstrappedKey.ok) {
          return profileWorkflowFailure(503, 'key.bootstrap_failed', 'failed to derive node key')
        }
        await deps.dataPlane.nodePublicKeys.upsert({
          ...bootstrappedKey.value,
          status: 'active'
        })
        publicKey = bootstrappedKey.value.publicKey
      }

      await deps.dataPlane.sidecarDesiredConfigs.upsert({
        nodeId: member.nodeId,
        configHash: `${networkId}:${profileVersion}:${resolved.tunnelIp}`,
        desiredAt: new Date().toISOString()
      })

      renderedMembers.push({
        nodeId: member.nodeId,
        nodeKind: member.nodeKind,
        tunnelIp: resolved.tunnelIp,
        publicKey: publicKey ?? bootstrapNodePublicKey(member.nodeId),
        ...(existingKey?.endpoint ? { endpoint: existingKey.endpoint } : {})
      })
    }

    await deps.dataPlane.relayAssignments.upsert({
      networkId,
      relayId: relayAssignment.nodeId,
      relayType: relayAssignment.relayType,
      endpoint: relayAssignment.relayEndpoint,
      assignedAt: new Date().toISOString()
    })

    const issuedAt = Date.now()
    let signingKey: ReturnType<typeof resolveNetworkMapSigningKeyMaterial>
    try {
      signingKey = resolveNetworkMapSigningKeyMaterial(process.env)
    } catch (error) {
      return profileWorkflowFailure(
        503,
        'network_map.signing_key_missing',
        error instanceof Error ? error.message : String(error)
      )
    }
    const map = renderNetworkMap({
      profileVersion,
      networkId,
      members: renderedMembers,
      requestedAclRules: buildRequestedAclRules(members),
      relayAssignment: {
        relayType: relayAssignment.relayType,
        relayEndpoint: relayAssignment.relayEndpoint,
        nodeIds: relayNodeIds
      },
      issuedAt,
      previousMapVersion: latestMap?.mapVersion ?? 0,
      signingKeyId: signingKey.keyId,
      signingPrivateKeyPem: signingKey.privateKeyPem,
      staleTtlMs: resolveNetworkMapStaleTtlMs(process.env)
    })

    await deps.dataPlane.networkMaps.save({
      networkId,
      mapVersion: map.mapVersion,
      profileVersion,
      map,
      signatureMetadata: map.signatureMetadata,
      expiresAt: new Date(map.expiresAt).toISOString(),
      publishedAt: new Date(issuedAt).toISOString()
    })

    const currentPartition = (await deps.dataPlane.partitionStates.get(networkId)) ?? {
      networkId,
      state: 'connected' as const,
      reason: { code: 'initial.connect' as const, detail: 'bootstrap connected' },
      transitionedAt: new Date(issuedAt).toISOString(),
      previousState: null
    }
    if (currentPartition.previousState !== null) {
      const transition = transitionPartitionState(currentPartition, {
        networkId,
        targetState: 'connected',
        reason: { code: 'network_map.refreshed', signedMapVersion: String(map.mapVersion) },
        transitionedAt: new Date(issuedAt).toISOString()
      })
      if (transition.kind === 'transitioned') {
        await deps.dataPlane.partitionStates.upsert(transition.state)
      }
    } else {
      await deps.dataPlane.partitionStates.upsert(currentPartition)
    }

    return { relayAssignment, mapVersion: map.mapVersion }
  } catch (error) {
    return asFailure(error)
  }
}

/** 获取最新签名地图；过期地图按 fail-closed 返回 typed error。 */
export async function fetchLatestNetworkMap(
  deps: DataPlaneDeps,
  networkId: string
): Promise<LatestNetworkMapSuccess | ProfileWorkflowFailure> {
  try {
    const latest = await deps.dataPlane.networkMaps.getLatest(networkId)
    if (!latest) {
      return profileWorkflowFailure(404, 'network_map.not_found', 'network map not found')
    }
    const decision = decideNetworkMapEnforcement({ map: latest.map, nowMs: Date.now() })
    if (decision.decision === 'fail_closed') {
      return profileWorkflowFailure(409, decision.reason, 'network map is stale or invalid')
    }
    return { map: latest.map }
  } catch (error) {
    return asFailure(error)
  }
}
