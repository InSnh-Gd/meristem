import type { MNetProfileVersionFromSchema } from '../../../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  type ProfileWorkflowFailure,
  profileWorkflowFailure
} from '../profile/profile-workflow-types.ts'
import {
  asFailure,
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

/** 渲染并持久化成员地址、密钥、relay 与 network-map。 */
export async function materializeMembers(
  deps: DataPlaneDeps,
  networkId: string,
  profileVersion: MNetProfileVersionFromSchema,
  correlationId: string
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

    // 先只读地解析每个成员的真实运行时密钥，再做任何分配/期望态写入。这样「无成员持有密钥」
    // 的 fail-closed 完全不产生副作用（不会为被隔离成员写 tunnel allocation 或 sidecar 期望态）。
    // 只认可真实注册的运行时密钥：`bootstrap-<nodeId>` 前缀是历史占位值，其公钥由 nodeId 派生、
    // 不是合法 X25519 点，会让 wg setconf 拒绝整份 peer 配置。无真实密钥的成员从 peer 集合隔离
    // （quarantine）：既不进 map，也不持久化占位密钥——长期死亡、密钥已回收的幽灵成员因此自动
    // 退出 map，无需额外按存活状态排除。成员注册密钥后会触发重渲染并自动进入 map。
    const keyedMembers: Array<{
      member: (typeof members)[number]
      publicKey: string
      endpoint?: string
    }> = []
    for (const member of members) {
      const runtimeKey = (await deps.dataPlane.nodePublicKeys.listByNode(member.nodeId)).find(
        key => key.keyId !== `bootstrap-${member.nodeId}` && key.status === 'active'
      )
      if (runtimeKey) {
        keyedMembers.push({
          member,
          publicKey: runtimeKey.publicKey,
          ...(runtimeKey.endpoint ? { endpoint: runtimeKey.endpoint } : {})
        })
      }
    }

    // 全部成员都无真实运行时密钥时 fail closed：发布一份 0 成员的签名 map 会让控制面报
    // enabled 而任何节点都无法建立隧道（agent 拿到 map 后在 wg.local_member_missing 失败），
    // 属 false success。节点注册密钥不依赖 map（agent 先注册密钥再取 map），故不会死锁首次 enable。
    if (keyedMembers.length === 0) {
      return profileWorkflowFailure(
        409,
        'network.no_runtime_keys',
        'no member holds a registered runtime key; register node keys before enabling'
      )
    }

    const existingAllocations = [
      ...(await deps.dataPlane.tunnelAllocations.listByNetwork(networkId))
    ]
    const latestMap = await deps.dataPlane.networkMaps.getLatest(networkId)
    const renderedMembers: Array<{
      nodeId: string
      nodeKind: 'stem' | 'leaf'
      tunnelIp: string
      publicKey: string
      endpoint?: string
    }> = []

    for (const { member, publicKey, endpoint } of keyedMembers) {
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

      await deps.dataPlane.sidecarDesiredConfigs.upsert({
        nodeId: member.nodeId,
        configHash: `${networkId}:${profileVersion}:${resolved.tunnelIp}`,
        desiredAt: new Date().toISOString()
      })

      renderedMembers.push({
        nodeId: member.nodeId,
        nodeKind: member.nodeKind,
        tunnelIp: resolved.tunnelIp,
        publicKey,
        ...(endpoint ? { endpoint } : {})
      })
    }

    // relay 必须取自**隔离后**的成员：否则无密钥的成员可能被选为 relay，并被写进持久化行、
    // enable 响应与 mnet.relay.assigned 事件，而它并不在 map 里。
    // selectRelayForMembers 优先 stem；若网络中没有持密钥的 stem（stem 未注册密钥，或拓扑本无
    // stem），会降级回退到另一个持密钥成员——该降级语义记录在 docs/services/m-net.md。
    // 此处不硬失败：registerNodePublicKey 也走本函数，硬失败会让「leaf 注册密钥」被兄弟 stem 的
    // 注册顺序阻塞。
    const relayAssignment = selectRelayForMembers(renderedMembers)
    const relayNodeIds = renderedMembers.map(member => member.nodeId)

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

    try {
      await deps.dataPlane.networkMaps.save({
        networkId,
        mapVersion: map.mapVersion,
        profileVersion,
        map,
        signatureMetadata: map.signatureMetadata,
        expiresAt: new Date(map.expiresAt).toISOString(),
        publishedAt: new Date(issuedAt).toISOString()
      })
    } catch (error) {
      throw new Error(
        `network_maps save failed for ${networkId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }

    // 网络地图变更写入 Timeline 与 Audit：地图是数据面授权事实，必须留下审计痕迹
    if (deps.log) {
      try {
        await deps.log.writeTimeline(
          `network map ${map.mapVersion} rendered for ${networkId} (${map.members.length} members)`,
          networkId
        )
        await deps.log.writeAudit(
          'meristem-m-net',
          'mnet.network_map.published',
          `network:${networkId}`,
          'success',
          correlationId
        )
      } catch (error) {
        // 审计日志写入失败不能阻断地图发布；后续同步会再次留下渲染事实
        process.stderr.write(
          `network map audit log failed for ${networkId}: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }
    }

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
