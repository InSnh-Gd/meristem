import { assessOfflineLeafMigration } from '../data-plane/data-plane-security-support.ts'
import {
  acquireOperationLock,
  type NetworkOperationLock,
  type OperationTransitionReason,
  releaseOperationLock
} from '../data-plane/operation-locks.ts'
import type { MigrationEngineDeps } from './migration-engine-types.ts'

const LOCK_TTL_MS = 5 * 60 * 1000

/** 构造成功结果，供迁移锁操作显式返回成功状态。 */
export const ok = <T>(value: T) => ({ ok: true as const, value })

/** 构造失败结果，供迁移锁操作显式返回失败原因。 */
export const fail = (error: string) => ({ ok: false as const, error })

/** 评估迁移后仍需要跟进的离线 Leaf 节点。 */
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

/** 为单一网络迁移申请排他操作锁。 */
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

/** 以完成原因释放已经持有的迁移操作锁。 */
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
