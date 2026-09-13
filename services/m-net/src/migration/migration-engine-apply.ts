import type { NetworkOperationLock } from '../data-plane/operation-locks.ts'
import type { NetworkProfileMigrationResult } from '../profile/global-defaults-store.ts'
import {
  type MigrationAlreadyApplied,
  type MigrationSuccess,
  migrateMNetProfile
} from '../profile/profile-migration.ts'
import {
  isCandidate,
  migrationResult,
  type NetworkSnapshot,
  readReason
} from './migration-engine-helpers.ts'
import { acquireLock, assessOffline, releaseLock } from './migration-engine-locks.ts'
import type { MigrationEngineDeps } from './migration-engine-pure.ts'
import { TARGET_CN_PROFILE_VERSION, toMigrationProfileCandidate } from './migration-engine-pure.ts'
import { getStoredMigration, storeMigration } from './migration-engine-storage.ts'

/**
 * 迁移引擎的 apply 编排：候选判定、锁获取、数据面迁移执行与结果落库。
 * rollback 见 migration-engine-rollback.ts；锁与存储访问见 migration-engine-locks.ts。
 */

type MigrationApplySuccess = MigrationSuccess | MigrationAlreadyApplied

async function finalizeAppliedMigration(
  deps: MigrationEngineDeps,
  input: {
    operation: { operationId: string; targetProfileVersion: string; reason: string }
    networkId: string
    actor: string
    batchId: number
    targetStatus?: 'enabled' | 'enabling'
  },
  state: NetworkSnapshot,
  migrated: MigrationApplySuccess,
  operationLock: NetworkOperationLock,
  timestamp: string,
  correlationId: string
): Promise<NetworkProfileMigrationResult> {
  try {
    const offline = await assessOffline(deps, input.networkId)
    const resultStatus = offline.kind === 'pending' ? 'pending' : 'applied'
    await deps.profileStore.setNetworkState(input.networkId, {
      profileVersion: migrated.profile.profileVersion,
      status: input.targetStatus ?? migrated.network.status
    })
    await deps.profileStore.recordTransition({
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: migrated.profile.profileVersion,
      fromStatus: state.status,
      toStatus: input.targetStatus ?? migrated.network.status,
      actor: input.actor,
      reason: input.operation.reason,
      correlationId
    })
    const auditId =
      (await deps.writeAudit({
        actor: input.actor,
        action:
          resultStatus === 'pending'
            ? 'mnet.profile.migration.pending'
            : migrated.kind === 'already-migrated'
              ? 'mnet.profile.migration.applied'
              : migrated.audit.action,
        resource: `network:${input.networkId}`,
        result: resultStatus === 'pending' ? 'pending' : 'applied',
        correlationId,
        metadata: {
          operationId: input.operation.operationId,
          batchId: input.batchId,
          offlineLeafNodeIds: offline.kind === 'pending' ? offline.pendingNodeIds : [],
          plannedEffects: migrated.plannedEffects
        }
      })) ?? correlationId
    await deps.writeTimeline?.({
      summary:
        resultStatus === 'pending'
          ? `migration pending follow-up for ${input.networkId}`
          : `migration applied for ${input.networkId}`,
      subject:
        resultStatus === 'pending'
          ? 'mnet.profile.migration.pending'
          : 'mnet.profile.migration.applied',
      correlationId
    })
    await deps.writeFull({
      level: 'info',
      message: `profile migration ${resultStatus} for ${input.networkId}`,
      correlationId,
      metadata: {
        operationId: input.operation.operationId,
        batchId: input.batchId,
        offlineLeafNodeIds: offline.kind === 'pending' ? offline.pendingNodeIds : []
      }
    })
    await storeMigration(deps, {
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: input.operation.targetProfileVersion,
      operationId: input.operation.operationId,
      status: resultStatus,
      timestamp,
      auditMetadata: {
        auditId,
        plannedEffects: migrated.plannedEffects,
        ...(offline.kind === 'pending' ? { reason: offline.message } : {})
      }
    })
    await releaseLock(deps, operationLock, timestamp)
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      resultStatus,
      {
        correlationId,
        auditId,
        ...(offline.kind === 'pending' ? { reason: offline.message } : {})
      }
    )
  } catch {
    await releaseLock(deps, operationLock, timestamp)
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: 'internal error during apply'
      }
    )
  }
}

// ── 核心 apply ──────────────────────────────────────

export async function applyNetwork(
  deps: MigrationEngineDeps,
  input: {
    operation: { operationId: string; targetProfileVersion: string; reason: string }
    networkId: string
    actor: string
    batchId: number
    targetStatus?: 'enabled' | 'enabling'
  }
): Promise<NetworkProfileMigrationResult> {
  const correlationId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const state = await deps.profileStore.getNetworkState(input.networkId)
  if (!state) {
    return migrationResult(
      input.networkId,
      'unknown',
      input.operation.targetProfileVersion,
      'skipped',
      { correlationId, reason: 'network not found' }
    )
  }
  if (!isCandidate(state, input.operation.targetProfileVersion)) {
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'skipped',
      { correlationId, reason: 'already compatible' }
    )
  }
  if (input.operation.targetProfileVersion !== TARGET_CN_PROFILE_VERSION) {
    return applyControlPlaneProfileSwitch(deps, input, state, correlationId)
  }
  const operationLock = await acquireLock(
    deps,
    input.networkId,
    input.operation.operationId,
    timestamp
  )
  if (!operationLock.ok) {
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: operationLock.error
      }
    )
  }
  const currentMigration = await getStoredMigration(
    deps,
    input.networkId,
    input.operation.operationId
  )
  if (currentMigration?.status === 'applied' || currentMigration?.status === 'pending') {
    await releaseLock(deps, operationLock.value, timestamp)
    const currentReason =
      currentMigration.status === 'pending' ? readReason(currentMigration.auditMetadata) : undefined
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      currentMigration.status as 'applied' | 'pending',
      {
        correlationId,
        ...(currentReason !== undefined ? { reason: currentReason } : {})
      }
    )
  }
  const migrated = migrateMNetProfile({
    profile: toMigrationProfileCandidate(state),
    network: {
      networkId: input.networkId,
      profileVersion: state.profileVersion,
      status: state.status === 'disabled' || state.status === 'enabled' ? state.status : 'disabled',
      activeBreakGlass: false,
      operationStatus: 'idle'
    },
    operationId: input.operation.operationId,
    actor: input.actor,
    reason: input.operation.reason
  })
  if (migrated.kind === 'unsupported-version') {
    await storeMigration(deps, {
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: input.operation.targetProfileVersion,
      operationId: input.operation.operationId,
      status: 'failed',
      timestamp,
      auditMetadata: { error: migrated.error }
    })
    await releaseLock(deps, operationLock.value, timestamp)
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: migrated.error.code
      }
    )
  }
  if (migrated.kind === 'not-eligible') {
    await storeMigration(deps, {
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: input.operation.targetProfileVersion,
      operationId: input.operation.operationId,
      status: 'failed',
      timestamp,
      auditMetadata: { reasons: migrated.reasons }
    })
    await releaseLock(deps, operationLock.value, timestamp)
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: migrated.reasons.join(',')
      }
    )
  }
  return finalizeAppliedMigration(
    deps,
    input,
    state,
    migrated,
    operationLock.value,
    timestamp,
    correlationId
  )
}

/** 非 0.2 数据面迁移目标只需要切换控制面 profile 记录。 */
async function applyControlPlaneProfileSwitch(
  deps: MigrationEngineDeps,
  input: {
    operation: { operationId: string; targetProfileVersion: string; reason: string }
    networkId: string
    actor: string
    batchId: number
    targetStatus?: 'enabled' | 'enabling'
  },
  state: NetworkSnapshot,
  correlationId: string
): Promise<NetworkProfileMigrationResult> {
  const timestamp = new Date().toISOString()
  try {
    await deps.profileStore.setNetworkState(input.networkId, {
      profileVersion: input.operation.targetProfileVersion,
      status: input.targetStatus ?? state.status
    })
    await deps.profileStore.recordTransition({
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: input.operation.targetProfileVersion,
      fromStatus: state.status,
      toStatus: input.targetStatus ?? state.status,
      actor: input.actor,
      reason: input.operation.reason,
      correlationId
    })
    const auditId =
      (await deps.writeAudit({
        actor: input.actor,
        action: 'mnet.profile.migration.applied',
        resource: `network:${input.networkId}`,
        result: 'applied',
        correlationId,
        metadata: {
          operationId: input.operation.operationId,
          batchId: input.batchId,
          mode: 'control-plane-switch'
        }
      })) ?? correlationId
    await deps.writeFull({
      level: 'info',
      message: `profile migration applied for ${input.networkId}`,
      correlationId,
      metadata: {
        operationId: input.operation.operationId,
        batchId: input.batchId,
        mode: 'control-plane-switch'
      }
    })
    await storeMigration(deps, {
      networkId: input.networkId,
      fromVersion: state.profileVersion,
      toVersion: input.operation.targetProfileVersion,
      operationId: input.operation.operationId,
      status: 'applied',
      timestamp,
      auditMetadata: { auditId, mode: 'control-plane-switch' }
    })
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'applied',
      {
        correlationId,
        auditId
      }
    )
  } catch {
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: 'internal error during apply'
      }
    )
  }
}
