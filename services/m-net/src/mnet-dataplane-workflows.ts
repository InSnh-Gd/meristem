import { type NodePublicKeyMetadata, rejectDuplicatePublicKey } from './key-lifecycle.ts'
import { fetchLatestNetworkMap, materializeMembers } from './mnet-dataplane-materialize.ts'
import type {
  BreakGlassDataPlaneDeps,
  DataPlaneDeps,
  EnableDataPlaneSuccess,
  NodeKeyRegistrationSuccess
} from './mnet-dataplane-support.ts'
import {
  asFailure,
  getDataPlaneStores,
  requireDataPlaneDeps,
  writeOptionalArtifacts,
  writeRequiredAudit
} from './mnet-dataplane-support.ts'
import {
  acquireOperationLock,
  preemptWithBreakGlass,
  releaseOperationLock
} from './operation-locks.ts'
import { transitionPartitionState } from './partition-state.ts'
import { migrateMNetProfile } from './profile-migration.ts'
import {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  isProfileWorkflowFailure,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

/** 为 m-net-cn@0.2.0 执行持久化数据面编排。 */
export async function enableDataPlaneProfile(
  deps: DataPlaneDeps,
  input: { actor: string; networkId: string; reason: string }
): Promise<EnableDataPlaneSuccess | ProfileWorkflowFailure> {
  const correlationId = crypto.randomUUID()
  const auditWritten = await writeRequiredAudit(
    deps,
    input.actor,
    'mnet.profile.enable.request',
    `network:${input.networkId}`,
    'allow',
    correlationId,
    { profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION, reason: input.reason }
  )
  if (auditWritten !== true) return auditWritten

  try {
    const request = {
      networkId: input.networkId,
      operationType: 'apply' as const,
      operationId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      ttlMs: 15 * 60 * 1000,
      reason: { code: 'profile.apply' as const, detail: input.reason },
      idempotencyKey: `${input.networkId}:${CHINA_DATA_PLANE_PROFILE_VERSION}`
    }
    const lockResult = acquireOperationLock({
      existingLock: await deps.dataPlane.operationLocks.getActiveByNetwork(input.networkId),
      request
    })
    if (lockResult.kind === 'failure') {
      return profileWorkflowFailure(409, lockResult.failure.code, lockResult.failure.message)
    }
    try {
      await deps.dataPlane.operationLocks.upsert(lockResult.lock)
    } catch (error) {
      throw new Error(
        `operation_locks acquire upsert failed for ${input.networkId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const materialized = await materializeMembers(
      deps,
      input.networkId,
      CHINA_DATA_PLANE_PROFILE_VERSION,
      correlationId
    )
    if (isProfileWorkflowFailure(materialized)) return materialized

    await deps.profileStore.setNetworkState(input.networkId, {
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      status: 'enabled'
    })
    await deps.networkUpdater?.setProfileVersion(input.networkId, CHINA_DATA_PLANE_PROFILE_VERSION)
    await deps.profileStore.recordTransition({
      networkId: input.networkId,
      fromVersion: 'm-net-default@0.1.0',
      toVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      fromStatus: 'enabling',
      toStatus: 'enabled',
      actor: input.actor,
      reason: input.reason,
      correlationId
    })
    try {
      await deps.dataPlane.profileMigrations.upsert({
        networkId: input.networkId,
        operationId: request.operationId,
        fromVersion: 'm-net-cn@0.1.0',
        toVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
        status: 'applied',
        idempotencyKey: request.idempotencyKey ?? request.operationId,
        startedAt: request.requestedAt,
        completedAt: new Date().toISOString(),
        auditMetadata: { reason: input.reason }
      })
    } catch (error) {
      throw new Error(
        `profile_migrations upsert failed for ${input.networkId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const artifactsWritten = await writeOptionalArtifacts(deps, {
      correlationId,
      networkId: input.networkId,
      mapVersion: materialized.mapVersion,
      relayAssignment: materialized.relayAssignment,
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      operationId: request.operationId
    })
    if (artifactsWritten !== true) return artifactsWritten

    const released = releaseOperationLock(lockResult.lock, {
      completedAt: new Date().toISOString(),
      reason: { code: 'operation.completed', detail: 'data-plane profile enabled' }
    })
    if (released.kind === 'released') {
      try {
        await deps.dataPlane.operationLocks.upsert(released.lock)
      } catch (error) {
        throw new Error(
          `operation_locks release upsert failed for ${input.networkId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    return {
      status: 'enabled',
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      correlationId,
      operationId: request.operationId,
      mapVersion: materialized.mapVersion,
      relayAssignment: materialized.relayAssignment
    }
  } catch (error) {
    return asFailure(error)
  }
}

/** 注册节点公钥并重新发布最新签名地图。 */
export async function registerNodePublicKey(
  deps: DataPlaneDeps,
  input: {
    networkId: string
    nodeId: string
    keyId: string
    publicKey: string
    createdAt: string
    /** 节点的公网 WireGuard 端点（STUN 发现），用于直接 P2P 连接。 */
    endpoint?: string
  }
): Promise<NodeKeyRegistrationSuccess | ProfileWorkflowFailure> {
  try {
    const existingKeys = await deps.dataPlane.nodePublicKeys.listByNode(input.nodeId)
    const validated = rejectDuplicatePublicKey({ ...input, existingKeys })
    const correlationId = crypto.randomUUID()

    // 无效公钥（格式错误等）仍返回 409 拒绝。
    // 重复公钥视为幂等注册，仍触发 materializeMembers 刷新地图，避免地图过期后 node-agent 无法恢复。
    if (!validated.ok) {
      if (validated.error.kind !== 'key.duplicate') {
        return profileWorkflowFailure(
          409,
          validated.error.kind,
          'duplicate or invalid public key rejected'
        )
      }

      const materialized = await materializeMembers(
        deps,
        input.networkId,
        CHINA_DATA_PLANE_PROFILE_VERSION,
        correlationId
      )
      if (isProfileWorkflowFailure(materialized)) return materialized

      const existingKey = existingKeys.find(key => key.publicKey === input.publicKey)
      return {
        nodeId: input.nodeId,
        keyId: existingKey?.keyId ?? input.keyId,
        fingerprint: existingKey?.fingerprint ?? '',
        mapVersion: materialized.mapVersion,
        correlationId
      }
    }

    const rotationMetadata: NodePublicKeyMetadata = validated.value
    await deps.dataPlane.nodePublicKeys.upsert({
      ...rotationMetadata,
      status: 'active',
      ...(input.endpoint ? { endpoint: input.endpoint } : {})
    })

    const materialized = await materializeMembers(
      deps,
      input.networkId,
      CHINA_DATA_PLANE_PROFILE_VERSION,
      correlationId
    )
    if (isProfileWorkflowFailure(materialized)) return materialized

    await deps.events?.publish(
      'mnet.node_key.rotated.v0',
      'mnet.node_key.rotated',
      {
        networkId: input.networkId,
        nodeId: input.nodeId,
        keyId: input.keyId,
        fingerprint: rotationMetadata.fingerprint,
        correlationId
      },
      correlationId
    )
    await deps.events?.publish(
      'mnet.network_map.published.v0',
      'mnet.network_map.published',
      {
        networkId: input.networkId,
        mapVersion: materialized.mapVersion,
        profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
        relayAssignment: materialized.relayAssignment,
        correlationId
      },
      correlationId
    )

    return {
      nodeId: input.nodeId,
      keyId: input.keyId,
      fingerprint: rotationMetadata.fingerprint,
      mapVersion: materialized.mapVersion,
      correlationId
    }
  } catch (error) {
    return asFailure(error)
  }
}

/** break-glass 抢占数据面操作并把分区状态切到 fail_closed。 */
export async function breakGlassFailClosed(
  deps: BreakGlassDataPlaneDeps,
  input: { actor: string; networkId: string; reason: string }
): Promise<{ operationId: string } | ProfileWorkflowFailure> {
  try {
    const request = {
      networkId: input.networkId,
      operationType: 'break_glass' as const,
      operationId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      ttlMs: 15 * 60 * 1000,
      reason: {
        code: 'operator.break_glass' as const,
        actor: 'security-admin' as const,
        detail: input.reason
      }
    }
    const preempted = preemptWithBreakGlass(
      await deps.dataPlane.operationLocks.getActiveByNetwork(input.networkId),
      request
    )
    if (preempted.kind === 'failure') {
      return profileWorkflowFailure(409, preempted.failure.code, preempted.failure.message)
    }
    await deps.dataPlane.operationLocks.upsert(
      preempted.kind === 'preempted' ? preempted.interruptedLock : preempted.breakGlassLock
    )
    await deps.dataPlane.operationLocks.upsert(preempted.breakGlassLock)

    const membersResult = await deps.listMembers({ networkId: input.networkId })
    if (membersResult.ok) {
      await Promise.all(
        membersResult.value.map(member =>
          deps.dataPlane.sidecarDesiredConfigs.upsert({
            nodeId: member.nodeId,
            configHash: `fail-closed:${input.networkId}`,
            desiredAt: new Date().toISOString()
          })
        )
      )
    }

    const current = (await deps.dataPlane.partitionStates.get(input.networkId)) ?? {
      networkId: input.networkId,
      state: 'connected' as const,
      reason: { code: 'initial.connect' as const, detail: 'bootstrap connected' },
      transitionedAt: new Date().toISOString(),
      previousState: null
    }
    const transition = transitionPartitionState(current, {
      networkId: input.networkId,
      targetState: 'fail_closed',
      reason: { code: 'operator.fail_closed', actor: input.actor, detail: input.reason },
      transitionedAt: new Date().toISOString()
    })
    if (transition.kind === 'transitioned') {
      await deps.dataPlane.partitionStates.upsert(transition.state)
    }
    await deps.events?.publish(
      'mnet.profile.disabled.v0',
      'mnet.profile.disabled',
      {
        networkId: input.networkId,
        actor: input.actor,
        reason: input.reason,
        correlationId: request.operationId,
        controlPlaneOnly: false
      },
      request.operationId
    )
    return { operationId: request.operationId }
  } catch (error) {
    return asFailure(error)
  }
}

/** 默认切到 0.2.0 时，对 0.1.0 网络执行幂等迁移记录与目标态推进。 */
export async function autoMigrateCnDefaults(
  deps: {
    profileStore: NonNullable<ProfileWriteDeps['profileStore']>
    dataPlane: import('./data-plane-store-types.ts').DataPlaneStores
  },
  actor: string
): Promise<void> {
  const states = await deps.profileStore.listNetworkStates()
  for (const state of states) {
    if (state.profileVersion !== 'm-net-cn@0.1.0') continue
    const plan = migrateMNetProfile({
      profile: {
        profileVersion: 'm-net-cn@0.1.0',
        schemaVersion: 'mnet-profile@0.1.0',
        region: 'cn',
        displayName: 'M-Net CN',
        status: 'available',
        rules: {},
        capabilities: {
          realWstunnelRelay: false,
          realTcpInterconnect: false,
          realUdpPathSwitching: false,
          controlPlaneOnly: true
        }
      },
      network: {
        networkId: state.networkId,
        profileVersion: state.profileVersion,
        status: state.status === 'enabled' ? 'enabled' : 'disabled',
        activeBreakGlass: false,
        operationStatus: 'idle'
      },
      operationId: crypto.randomUUID(),
      actor,
      reason: 'default switch auto-migration'
    })
    if (plan.kind !== 'migrated') continue
    await deps.profileStore.setNetworkState(state.networkId, {
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      status: state.status
    })
    await deps.dataPlane.profileMigrations.upsert({
      networkId: state.networkId,
      operationId: plan.audit.operationId,
      fromVersion: 'm-net-cn@0.1.0',
      toVersion: CHINA_DATA_PLANE_PROFILE_VERSION,
      status: 'planned',
      idempotencyKey: `${state.networkId}:default-switch`,
      startedAt: new Date().toISOString(),
      auditMetadata: { actor, plannedEffects: plan.plannedEffects }
    })
  }
}

export {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  fetchLatestNetworkMap,
  getDataPlaneStores,
  requireDataPlaneDeps
}
