import { migrateMNetProfile } from '../profile/profile-migration.ts'
import {
  applyControlPlaneProfileSwitch,
  finalizeAppliedMigration
} from './migration-engine-application-effects.ts'
import { isCandidate, migrationResult, readReason } from './migration-engine-helpers.ts'
import { acquireLock, releaseLock } from './migration-engine-locks.ts'
import { toMigrationProfileCandidate } from './migration-engine-profile-candidate.ts'
import { getStoredMigration, storeMigration } from './migration-engine-storage.ts'
import {
  type MigrationEngineDeps,
  type NetworkProfileMigrationResult,
  TARGET_CN_PROFILE_VERSION
} from './migration-engine-types.ts'

/** 执行单网络 profile 迁移，并保留锁、审计、日志和幂等语义。 */
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
      { correlationId, reason: operationLock.error }
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
      { correlationId, ...(currentReason === undefined ? {} : { reason: currentReason }) }
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
      { correlationId, reason: migrated.error.code }
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
      { correlationId, reason: migrated.reasons.join(',') }
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
