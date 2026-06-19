import type { MNetworkMember } from '../../../packages/contracts/src/index.ts'
import { assessOfflineLeafMigration } from './data-plane-security-support.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type {
  GlobalDefaultsStore,
  NetworkProfileMigrationResult,
  SwitchBatch,
  SwitchOperationStatus
} from './global-defaults-store.ts'

export type { NetworkProfileMigrationResult, SwitchBatch, SwitchOperationStatus }

import {
  acquireOperationLock,
  type NetworkOperationLock,
  type OperationTransitionReason,
  releaseOperationLock
} from './operation-locks.ts'
import {
  type MigrationAlreadyApplied,
  type MigrationProfileCandidate,
  type MigrationSuccess,
  migrateMNetProfile
} from './profile-migration.ts'
import type { ProfileStore } from './profile-store.ts'
import {
  type NetworkSnapshot,
  isCandidate,
  migrationResult,
  readReason
} from './migration-engine-helpers.ts'
import { toStoredProfileMigrationRecord } from './migration-storage-utils.ts'

export type MigrationEngineDeps = {
  globalDefaultsStore: GlobalDefaultsStore
  profileStore: ProfileStore
  dataPlane: DataPlaneStores
  listMembers?: (input: {
    networkId: string
  }) => Promise<
    { ok: true; value: MNetworkMember[] } | { ok: false; error: { code: string; message: string } }
  >
  writeAudit: (input: {
    actor: string
    action: string
    resource: string
    result: string
    correlationId: string
    metadata?: unknown
  }) => Promise<string | undefined>
  writeFull: (input: {
    level: string
    message: string
    correlationId: string
    metadata?: unknown
  }) => Promise<void>
  writeTimeline?: (input: {
    summary: string
    subject: string
    correlationId: string
  }) => Promise<void>
}

export const TARGET_CN_PROFILE_VERSION = 'm-net-cn@0.2.0'
const LOCK_TTL_MS = 5 * 60 * 1000

export type PlanMigrationResult = {
  operationId: string
  candidateCount: number
  candidates: string[]
  batches: SwitchBatch[]
}

type MigrationApplySuccess = MigrationSuccess | MigrationAlreadyApplied

export const ok = <T>(value: T) => ({ ok: true as const, value })
export const fail = (error: string) => ({ ok: false as const, error })

// ── 锁操作 ──────────────────────────────────────────

export async function assessOffline(
  deps: Pick<MigrationEngineDeps, 'dataPlane' | 'listMembers'>,
  networkId: string
) {
  const partition = await deps.dataPlane.partitionStates.get(networkId)
  const members = deps.listMembers
    ? await deps.listMembers({ networkId })
    : { ok: true as const, value: [] }
  if (!members.ok) return { kind: 'ready' as const, pendingNodeIds: [] as const }
  return assessOfflineLeafMigration(
    members.value.map(member => ({
      nodeId: member.nodeId,
      nodeKind: member.nodeKind,
      status:
        partition && partition.state !== 'connected' && member.nodeKind === 'leaf'
          ? 'offline'
          : 'joined'
    }))
  )
}

export async function acquireLock(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  networkId: string,
  operationId: string,
  requestedAt: string
): Promise<{ ok: true; value: NetworkOperationLock } | { ok: false; error: string }> {
  const currentLock = await deps.dataPlane.operationLocks.getActiveByNetwork(networkId)
  const request = {
    networkId,
    operationType: 'migration' as const,
    operationId,
    idempotencyKey: `${operationId}:${networkId}`,
    requestedAt,
    ttlMs: LOCK_TTL_MS,
    reason: {
      code: 'profile.migration',
      detail: 'm-net profile migration apply'
    } satisfies OperationTransitionReason
  }
  const acquired = acquireOperationLock({ existingLock: currentLock, request })
  if (acquired.kind === 'failure') return fail(acquired.failure.message)
  if (acquired.expiredLock) await deps.dataPlane.operationLocks.upsert(acquired.expiredLock)
  await deps.dataPlane.operationLocks.upsert(acquired.lock)
  return ok(acquired.lock)
}

export async function releaseLock(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  lock: NetworkOperationLock,
  completedAt: string
) {
  const released = releaseOperationLock(lock, {
    completedAt,
    reason: { code: 'operation.completed', detail: 'm-net profile migration complete' }
  })
  if (released.kind === 'released') await deps.dataPlane.operationLocks.upsert(released.lock)
}

// ── 迁移存储 ────────────────────────────────────────

export async function getStoredMigration(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  networkId: string,
  operationId: string
) {
  return deps.dataPlane.profileMigrations.get(networkId, operationId)
}

export async function storeMigration(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  input: {
    networkId: string
    fromVersion: string
    toVersion: string
    operationId: string
    status: string
    timestamp: string
    auditMetadata: Record<string, unknown>
  }
) {
  const current = await getStoredMigration(deps, input.networkId, input.operationId)
  const record = toStoredProfileMigrationRecord(input, current?.startedAt)
  await deps.dataPlane.profileMigrations.upsert(record)
}

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
}

// ── 核心 apply / rollback ───────────────────────────

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
  const profile = await deps.profileStore.getDefinition(state.profileVersion)
  if (!profile) {
    return migrationResult(
      input.networkId,
      state.profileVersion,
      input.operation.targetProfileVersion,
      'failed',
      {
        correlationId,
        reason: `profile definition missing: ${state.profileVersion}`
      }
    )
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
    profile: profile as MigrationProfileCandidate,
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
