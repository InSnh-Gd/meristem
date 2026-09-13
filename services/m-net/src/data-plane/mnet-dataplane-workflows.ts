import { applyProfileTransition } from '../profile/profile-transition.ts'
import {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  DEFAULT_PROFILE_VERSION,
  isProfileWorkflowFailure,
  type ProfileWorkflowFailure,
  profileWorkflowFailure,
  V03_CN_PROFILE_VERSION,
  V03_PROFILE_VERSION
} from '../profile/profile-workflow-types.ts'
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
  createNetBirdAdapter,
  type NetBirdAdapterEnabledResult,
  type NetBirdAdapterRejectedResult,
  type NetBirdResolvedControlPlaneConfig
} from './netbird-adapter.ts'
import type { DisabledDataPlaneAdapterResult } from './noop-adapter.ts'
import { createDataPlaneAdapter } from './noop-adapter.ts'
import {
  acquireOperationLock,
  preemptWithBreakGlass,
  releaseOperationLock
} from './operation-locks.ts'
import { transitionPartitionState } from './partition-state.ts'

type DataPlaneAdapterSelectionInput =
  | {
      readonly profileVersion: typeof V03_PROFILE_VERSION | typeof V03_CN_PROFILE_VERSION
      readonly fallbackMode?: 'disabled' | 'local'
      readonly netbirdControlPlane: NetBirdResolvedControlPlaneConfig
    }
  | {
      readonly profileVersion: string
      readonly fallbackMode: 'disabled' | 'local'
      readonly netbirdControlPlane?: NetBirdResolvedControlPlaneConfig
    }

export type DataPlaneAdapterSelection =
  | NetBirdAdapterEnabledResult
  | NetBirdAdapterRejectedResult
  | DisabledDataPlaneAdapterResult

function isV03ProfileVersion(
  value: string
): value is typeof V03_PROFILE_VERSION | typeof V03_CN_PROFILE_VERSION {
  return value === V03_PROFILE_VERSION || value === V03_CN_PROFILE_VERSION
}

function isNetBirdEnabled(
  adapter: DataPlaneAdapterSelection
): adapter is NetBirdAdapterEnabledResult {
  return adapter.enabled === true
}

function readAdapterRejection(adapter: DataPlaneAdapterSelection): {
  code: string
  message: string
} {
  if ('error' in adapter) return adapter.error
  return {
    code: 'netbird.adapter.noop',
    message: 'NetBird adapter is not active for this data-plane profile'
  }
}

async function selectAdapterForEnable(
  deps: DataPlaneDeps,
  input: {
    networkId: string
    profileVersion: typeof V03_PROFILE_VERSION | typeof V03_CN_PROFILE_VERSION
  }
): Promise<DataPlaneAdapterSelection> {
  const controlPlane = deps.resolveNetBirdControlPlane
    ? await deps.resolveNetBirdControlPlane(input)
    : null

  if (!controlPlane) {
    return {
      enabled: false,
      status: 'rejected',
      error: {
        code: 'netbird.config.missing_control_plane',
        message: 'NetBird adapter requires SecretProvider-resolved control-plane inputs',
        fields: ['resolveNetBirdControlPlane']
      }
    }
  }

  return selectDataPlaneAdapter({
    profileVersion: input.profileVersion,
    netbirdControlPlane: controlPlane
  })
}

/** 根据 Profile 与显式回退模式选择数据面 adapter。 */
export function selectDataPlaneAdapter(
  input: DataPlaneAdapterSelectionInput
): DataPlaneAdapterSelection {
  if (input.fallbackMode) {
    return createDataPlaneAdapter({ enabled: false, mode: input.fallbackMode })
  }

  return createNetBirdAdapter({
    profileVersion: input.profileVersion,
    controlPlane: input.netbirdControlPlane
  })
}

async function persistAdapterDesiredState(
  deps: DataPlaneDeps,
  input: {
    networkId: string
    profileVersion: typeof V03_PROFILE_VERSION | typeof V03_CN_PROFILE_VERSION
    adapter: DataPlaneAdapterSelection
    desiredAt: string
  }
): Promise<true | ProfileWorkflowFailure> {
  const membersResult = await deps.listMembers({ networkId: input.networkId })
  if (!membersResult.ok) {
    return profileWorkflowFailure(404, membersResult.error.code, membersResult.error.message)
  }

  if (isNetBirdEnabled(input.adapter)) {
    const adapter = input.adapter
    await Promise.all(
      membersResult.value.map(member =>
        deps.dataPlane.sidecarDesiredConfigs.upsert({
          nodeId: member.nodeId,
          configHash: adapter.clientConfig.configHash,
          desiredAt: input.desiredAt,
          adapterStatus: 'netbird',
          desiredState: adapter.desiredState,
          clientConfig: adapter.clientConfig
        })
      )
    )
    return true
  }

  const rejection = readAdapterRejection(input.adapter)
  await Promise.all(
    membersResult.value.map(member =>
      deps.dataPlane.sidecarDesiredConfigs.upsert({
        nodeId: member.nodeId,
        configHash: `${input.networkId}:${input.profileVersion}:netbird-degraded`,
        desiredAt: input.desiredAt,
        adapterStatus: 'degraded',
        degradedReason: {
          code: rejection.code,
          message: rejection.message
        }
      })
    )
  )
  return profileWorkflowFailure(503, rejection.code, rejection.message)
}

/** 为 m-net-cn@0.3.0 执行持久化数据面编排。 */
export async function enableDataPlaneProfile(
  deps: DataPlaneDeps,
  input: {
    actor: string
    networkId: string
    reason: string
    profileVersion?: typeof V03_PROFILE_VERSION | typeof V03_CN_PROFILE_VERSION
  }
): Promise<EnableDataPlaneSuccess | ProfileWorkflowFailure> {
  const profileVersion = input.profileVersion ?? CHINA_DATA_PLANE_PROFILE_VERSION
  const correlationId = crypto.randomUUID()
  const auditWritten = await writeRequiredAudit(
    deps,
    input.actor,
    'mnet.profile.enable.request',
    `network:${input.networkId}`,
    'allow',
    correlationId,
    { profileVersion, reason: input.reason }
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
      idempotencyKey: `${input.networkId}:${profileVersion}`
    }
    const lockResult = acquireOperationLock({
      existingLock: await deps.dataPlane.operationLocks.getActiveByNetwork(input.networkId),
      request
    })
    if (lockResult.kind === 'failure') {
      return profileWorkflowFailure(409, lockResult.failure.code, lockResult.failure.message)
    }
    await deps.dataPlane.operationLocks.upsert(lockResult.lock)

    // 获取锁之后的全部退出路径（成功、typed 失败、以及任何抛出的异常）都必须释放锁：
    // 否则一次失败会在 15 分钟 TTL 内持续以 409 拒绝该网络的后续 enable 与 migration。
    // 用 try/finally 统一覆盖，避免只处理 return 而漏掉 thrown 路径（store/networkUpdater 抖动）。
    try {
      const materialized = await materializeMembers(
        deps,
        input.networkId,
        profileVersion,
        correlationId
      )
      if (isProfileWorkflowFailure(materialized)) return materialized

      const adapter = isV03ProfileVersion(profileVersion)
        ? await selectAdapterForEnable(deps, { networkId: input.networkId, profileVersion })
        : createDataPlaneAdapter({ enabled: false, mode: 'disabled' })
      const adapterPersisted = await persistAdapterDesiredState(deps, {
        networkId: input.networkId,
        profileVersion,
        adapter,
        desiredAt: new Date().toISOString()
      })
      if (adapterPersisted !== true) return adapterPersisted

      // 目标状态 enabled 由状态机表 enable_success 行决定；状态事实与迁移记录统一走 applyProfileTransition。
      await applyProfileTransition(deps.profileStore, {
        networkId: input.networkId,
        fromState: { profileVersion: DEFAULT_PROFILE_VERSION, status: 'enabling' },
        actions: ['enable_success'],
        stateProfileVersion: profileVersion,
        transitionToVersion: profileVersion,
        actor: input.actor,
        reason: input.reason,
        correlationId
      })
      await deps.networkUpdater?.setProfileVersion(input.networkId, profileVersion)
      await deps.dataPlane.profileMigrations.upsert({
        networkId: input.networkId,
        operationId: request.operationId,
        fromVersion: DEFAULT_PROFILE_VERSION,
        toVersion: profileVersion,
        status: 'applied',
        idempotencyKey: request.idempotencyKey ?? request.operationId,
        startedAt: request.requestedAt,
        completedAt: new Date().toISOString(),
        auditMetadata: { reason: input.reason }
      })

      const artifactsWritten = await writeOptionalArtifacts(deps, {
        correlationId,
        networkId: input.networkId,
        mapVersion: materialized.mapVersion,
        relayAssignment: materialized.relayAssignment,
        profileVersion,
        operationId: request.operationId
      })
      if (artifactsWritten !== true) return artifactsWritten

      return {
        status: 'enabled',
        profileVersion,
        correlationId,
        operationId: request.operationId,
        mapVersion: materialized.mapVersion,
        relayAssignment: materialized.relayAssignment
      }
    } finally {
      const released = releaseOperationLock(lockResult.lock, {
        completedAt: new Date().toISOString(),
        reason: { code: 'operation.completed', detail: 'data-plane profile enable finished' }
      })
      if (released.kind === 'released') {
        await deps.dataPlane.operationLocks.upsert(released.lock)
      }
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

export {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  fetchLatestNetworkMap,
  getDataPlaneStores,
  requireDataPlaneDeps
}
