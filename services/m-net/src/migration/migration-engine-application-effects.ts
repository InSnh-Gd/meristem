import type { NetworkOperationLock } from '../data-plane/operation-locks.ts'
import type { MigrationAlreadyApplied, MigrationSuccess } from '../profile/profile-migration.ts'
import { migrationResult, type NetworkSnapshot } from './migration-engine-helpers.ts'
import { assessOffline, releaseLock } from './migration-engine-locks.ts'
import { storeMigration } from './migration-engine-storage.ts'
import type {
  MigrationEngineDeps,
  NetworkProfileMigrationResult
} from './migration-engine-types.ts'

type MigrationApplySuccess = MigrationSuccess | MigrationAlreadyApplied

/** 单网络迁移在状态更新、审计和存储步骤之间共享的操作输入。 */
export type MigrationApplyInput = {
  operation: { operationId: string; targetProfileVersion: string; reason: string }
  networkId: string
  actor: string
  batchId: number
  targetStatus?: 'enabled' | 'enabling'
}

/** 完成数据面迁移后的状态、日志、审计和迁移记录收尾。 */
export async function finalizeAppliedMigration(
  deps: MigrationEngineDeps,
  input: MigrationApplyInput,
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
      { correlationId, reason: 'internal error during apply' }
    )
  }
}

/** 非 0.2 数据面迁移目标只需要切换控制面 profile 记录。 */
export async function applyControlPlaneProfileSwitch(
  deps: MigrationEngineDeps,
  input: MigrationApplyInput,
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
      { correlationId, auditId }
    )
  } catch {
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      { correlationId, reason: 'internal error during apply' }
    )
  }
}
