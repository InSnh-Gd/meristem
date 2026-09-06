import { assessOfflineLeafMigration } from './data-plane-security-support.ts'
import type { MigrationEngineDeps } from './migration-engine-pure.ts'
import { fail, ok } from './migration-engine-pure.ts'
import { toStoredProfileMigrationRecord } from './migration-storage-utils.ts'
import {
  acquireOperationLock,
  type NetworkOperationLock,
  type OperationTransitionReason,
  releaseOperationLock
} from './operation-locks.ts'

/**
 * 迁移引擎的锁编排与迁移存储访问：acquire/release operation lock、
 * 离线 leaf 评估以及 profile 迁移记录读写。
 */

const LOCK_TTL_MS = 5 * 60 * 1000

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
