import { eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  mnetDataPlaneOperationLocks,
  mnetPartitionStates,
  mnetSidecarDesiredConfigs
} from '../../../packages/db/src/schema.ts'
import type { DataPlaneStores, StoredSidecarDesiredConfig } from './data-plane-store-types.ts'
import { buildOperationLock, buildPartitionState } from './store-codecs.ts'

/**
 * 创建运行期数据面状态存储，覆盖操作锁、sidecar 期望配置与分区状态。
 */
export function createPgRuntimeDataPlaneStores(
  db: MeristemDb
): Pick<DataPlaneStores, 'operationLocks' | 'sidecarDesiredConfigs' | 'partitionStates'> {
  return {
    operationLocks: {
      async upsert(lock) {
        await db
          .insert(mnetDataPlaneOperationLocks)
          .values({
            operationId: lock.operationId,
            networkId: lock.networkId,
            operationType: lock.operationType,
            idempotencyKey: lock.idempotencyKey ?? null,
            acquiredAt: new Date(lock.acquiredAt),
            expiresAt: new Date(lock.expiresAt),
            status: lock.status,
            lockRowId: lock.lockRowId,
            fencingToken: lock.fencingToken,
            updatedAt: new Date(lock.updatedAt)
          })
          .onConflictDoUpdate({
            target: mnetDataPlaneOperationLocks.operationId,
            set: {
              networkId: lock.networkId,
              operationType: lock.operationType,
              idempotencyKey: lock.idempotencyKey ?? null,
              acquiredAt: new Date(lock.acquiredAt),
              expiresAt: new Date(lock.expiresAt),
              status: lock.status,
              lockRowId: lock.lockRowId,
              fencingToken: lock.fencingToken,
              updatedAt: new Date(lock.updatedAt)
            }
          })
      },
      async getByOperationId(operationId) {
        const [row] = await db
          .select()
          .from(mnetDataPlaneOperationLocks)
          .where(eq(mnetDataPlaneOperationLocks.operationId, operationId))
          .limit(1)
        return row
          ? buildOperationLock({
              networkId: row.networkId,
              operationType: row.operationType,
              operationId: row.operationId,
              idempotencyKey: row.idempotencyKey,
              acquiredAt: row.acquiredAt,
              expiresAt: row.expiresAt,
              status: row.status,
              lockRowId: row.lockRowId,
              fencingToken: row.fencingToken,
              updatedAt: row.updatedAt
            })
          : null
      },
      async getActiveByNetwork(networkId) {
        const rows = await db
          .select()
          .from(mnetDataPlaneOperationLocks)
          .where(eq(mnetDataPlaneOperationLocks.networkId, networkId))
        for (const row of rows) {
          const lock = buildOperationLock({
            networkId: row.networkId,
            operationType: row.operationType,
            operationId: row.operationId,
            idempotencyKey: row.idempotencyKey,
            acquiredAt: row.acquiredAt,
            expiresAt: row.expiresAt,
            status: row.status,
            lockRowId: row.lockRowId,
            fencingToken: row.fencingToken,
            updatedAt: row.updatedAt
          })
          if (lock?.status === 'active') return lock
        }
        return null
      },
      async listByNetwork(networkId) {
        const rows = await db
          .select()
          .from(mnetDataPlaneOperationLocks)
          .where(eq(mnetDataPlaneOperationLocks.networkId, networkId))
        return rows.flatMap(row => {
          const lock = buildOperationLock({
            networkId: row.networkId,
            operationType: row.operationType,
            operationId: row.operationId,
            idempotencyKey: row.idempotencyKey,
            acquiredAt: row.acquiredAt,
            expiresAt: row.expiresAt,
            status: row.status,
            lockRowId: row.lockRowId,
            fencingToken: row.fencingToken,
            updatedAt: row.updatedAt
          })
          return lock ? [lock] : []
        })
      }
    },
    sidecarDesiredConfigs: {
      async upsert(record: StoredSidecarDesiredConfig) {
        await db
          .insert(mnetSidecarDesiredConfigs)
          .values({
            nodeId: record.nodeId,
            configHash: record.configHash,
            desiredAt: new Date(record.desiredAt),
            appliedAt: record.appliedAt ? new Date(record.appliedAt) : null
          })
          .onConflictDoUpdate({
            target: mnetSidecarDesiredConfigs.nodeId,
            set: {
              configHash: record.configHash,
              desiredAt: new Date(record.desiredAt),
              appliedAt: record.appliedAt ? new Date(record.appliedAt) : null
            }
          })
      },
      async get(nodeId) {
        const [row] = await db
          .select()
          .from(mnetSidecarDesiredConfigs)
          .where(eq(mnetSidecarDesiredConfigs.nodeId, nodeId))
          .limit(1)
        return row
          ? {
              nodeId: row.nodeId,
              configHash: row.configHash,
              desiredAt: row.desiredAt.toISOString(),
              ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {})
            }
          : null
      },
      async list() {
        const rows = await db.select().from(mnetSidecarDesiredConfigs)
        return rows.map(row => ({
          nodeId: row.nodeId,
          configHash: row.configHash,
          desiredAt: row.desiredAt.toISOString(),
          ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {})
        }))
      }
    },
    partitionStates: {
      async upsert(state) {
        await db
          .insert(mnetPartitionStates)
          .values({
            networkId: state.networkId,
            state: state.state,
            reason: state.reason,
            transitionedAt: new Date(state.transitionedAt),
            previousState: state.previousState
          })
          .onConflictDoUpdate({
            target: mnetPartitionStates.networkId,
            set: {
              state: state.state,
              reason: state.reason,
              transitionedAt: new Date(state.transitionedAt),
              previousState: state.previousState
            }
          })
      },
      async get(networkId) {
        const [row] = await db
          .select()
          .from(mnetPartitionStates)
          .where(eq(mnetPartitionStates.networkId, networkId))
          .limit(1)
        return row
          ? buildPartitionState({
              networkId: row.networkId,
              state: row.state,
              reason: row.reason,
              transitionedAt: row.transitionedAt,
              previousState: row.previousState
            })
          : null
      }
    }
  }
}
