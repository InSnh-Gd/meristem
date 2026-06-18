import { eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  mnetGlobalDefaults,
  mnetProfileDefaultSetResults,
  mnetProfileSwitchBatches,
  mnetProfileSwitchBatchMembers,
  mnetProfileSwitchOperations,
  mnetProfileSwitchResults,
  mnetProfileSwitchSnapshots
} from '../../../packages/db/src/schema.ts'
import type {
  GlobalDefaultsStore,
  GlobalSwitchState,
  NetworkProfileMigrationResult,
  SwitchOperation,
  SwitchOperationStatus
} from './global-defaults-store.ts'
import type { ProfileStore } from './profile-store.ts'

const defaultsRowId = 'singleton'

async function ensureGlobalDefaultsRow(db: MeristemDb): Promise<void> {
  await db
    .insert(mnetGlobalDefaults)
    .values({
      id: defaultsRowId,
      defaultProfileVersion: 'm-net-default@0.1.0',
      switchState: 'idle',
      switchOperationId: null,
      updatedAt: new Date()
    })
    .onConflictDoNothing()
}

function asSwitchState(value: string): GlobalSwitchState {
  return ['idle', 'planned', 'applying', 'applied', 'rolled_back', 'failed'].includes(value)
    ? (value as GlobalSwitchState)
    : 'idle'
}

function asResultStatus(value: string): NetworkProfileMigrationResult['status'] {
  return ['applied', 'skipped', 'failed', 'rolled_back', 'pending'].includes(value)
    ? (value as NetworkProfileMigrationResult['status'])
    : 'failed'
}

function toSwitchStatus(operation: SwitchOperation): SwitchOperationStatus {
  return {
    operationId: operation.operationId,
    targetProfileVersion: operation.targetProfileVersion,
    reason: operation.reason,
    batchSize: operation.batchSize,
    candidateCount: operation.batches.flatMap(batch => batch.networkIds).length,
    batches: operation.batches,
    completedBatchIds: operation.completedBatchIds,
    currentBatchId: operation.currentBatchId,
    results: operation.results,
    globalSwitchState: operation.state,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt
  }
}

async function loadSwitchOperation(
  db: MeristemDb,
  operationId: string
): Promise<SwitchOperation | null> {
  const [operation] = await db
    .select()
    .from(mnetProfileSwitchOperations)
    .where(eq(mnetProfileSwitchOperations.operationId, operationId))
    .limit(1)
  if (!operation) return null

  const [batchRows, memberRows, resultRows] = await Promise.all([
    db
      .select()
      .from(mnetProfileSwitchBatches)
      .where(eq(mnetProfileSwitchBatches.operationId, operationId)),
    db
      .select()
      .from(mnetProfileSwitchBatchMembers)
      .where(eq(mnetProfileSwitchBatchMembers.operationId, operationId)),
    db
      .select()
      .from(mnetProfileSwitchResults)
      .where(eq(mnetProfileSwitchResults.operationId, operationId))
  ])

  const batches = batchRows
    .slice()
    .sort((left, right) => left.batchId - right.batchId)
    .map(batch => ({
      batchId: batch.batchId,
      networkIds: memberRows
        .filter(member => member.batchId === batch.batchId)
        .map(member => member.networkId)
    }))

  const completedNetworkIds = new Set(resultRows.map(result => result.networkId))
  const completedBatchIds = batches
    .filter(batch => batch.networkIds.every(networkId => completedNetworkIds.has(networkId)))
    .map(batch => batch.batchId)

  return {
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    targetProfileVersion: operation.targetProfileVersion,
    batchSize: operation.batchSize,
    reason: operation.reason,
    state: asSwitchState(operation.state),
    completedBatchIds,
    currentBatchId: operation.currentBatchId,
    batches,
    results: resultRows.map(result => ({
      networkId: result.networkId,
      previousProfileVersion: result.previousProfileVersion,
      targetProfileVersion: result.targetProfileVersion,
      status: asResultStatus(result.status),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.auditId ? { auditId: result.auditId } : {}),
      ...(result.correlationId ? { correlationId: result.correlationId } : {})
    })),
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString()
  }
}

/**
 * 创建 PostgreSQL 全局默认值存储适配器，保证全局默认 profile 与批量切换状态跨重启持久化。
 */
export function createPgGlobalDefaultsStore(
  db: MeristemDb,
  profileStore: ProfileStore
): GlobalDefaultsStore {
  return {
    async getDefaultProfileVersion() {
      await ensureGlobalDefaultsRow(db)
      const [row] = await db
        .select()
        .from(mnetGlobalDefaults)
        .where(eq(mnetGlobalDefaults.id, defaultsRowId))
        .limit(1)
      return row?.defaultProfileVersion ?? 'm-net-default@0.1.0'
    },
    async setDefaultProfileVersion(profileVersion: string) {
      await ensureGlobalDefaultsRow(db)
      await db
        .update(mnetGlobalDefaults)
        .set({ defaultProfileVersion: profileVersion, updatedAt: new Date() })
        .where(eq(mnetGlobalDefaults.id, defaultsRowId))
    },
    async getSwitchState() {
      await ensureGlobalDefaultsRow(db)
      const [row] = await db
        .select()
        .from(mnetGlobalDefaults)
        .where(eq(mnetGlobalDefaults.id, defaultsRowId))
        .limit(1)
      return {
        state: asSwitchState(row?.switchState ?? 'idle'),
        switchOperationId: row?.switchOperationId ?? undefined,
        updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString()
      }
    },
    async createSwitchOperation(input) {
      await ensureGlobalDefaultsRow(db)
      const createdAt = new Date()
      const operationId = `mnet-migration-${crypto.randomUUID()}`
      await db.transaction(async tx => {
        await tx.insert(mnetProfileSwitchOperations).values({
          operationId,
          idempotencyKey: input.idempotencyKey,
          targetProfileVersion: input.targetProfileVersion,
          batchSize: input.batchSize,
          reason: input.reason,
          state: 'planned',
          currentBatchId: null,
          createdAt,
          updatedAt: createdAt
        })
        if (input.batches.length > 0) {
          await tx
            .insert(mnetProfileSwitchBatches)
            .values(input.batches.map(batch => ({ operationId, batchId: batch.batchId })))
          await tx.insert(mnetProfileSwitchBatchMembers).values(
            input.batches.flatMap(batch =>
              batch.networkIds.map(networkId => ({
                operationId,
                batchId: batch.batchId,
                networkId
              }))
            )
          )
        }
        const snapshotRows: Array<{
          operationId: string
          networkId: string
          previousProfileVersion: string
        }> = []
        for (const batch of input.batches) {
          for (const networkId of batch.networkIds) {
            const state = await profileStore.getNetworkState(networkId)
            snapshotRows.push({
              operationId,
              networkId,
              previousProfileVersion: state?.profileVersion ?? 'm-net-default@0.1.0'
            })
          }
        }
        if (snapshotRows.length > 0) {
          await tx.insert(mnetProfileSwitchSnapshots).values(snapshotRows)
        }
        await tx
          .update(mnetGlobalDefaults)
          .set({ switchState: 'planned', switchOperationId: operationId, updatedAt: createdAt })
          .where(eq(mnetGlobalDefaults.id, defaultsRowId))
      })
      const operation = await loadSwitchOperation(db, operationId)
      if (!operation) throw new Error('failed to create switch operation')
      return operation
    },
    async getSwitchOperationByIdempotencyKey(idempotencyKey: string) {
      const [row] = await db
        .select()
        .from(mnetProfileSwitchOperations)
        .where(eq(mnetProfileSwitchOperations.idempotencyKey, idempotencyKey))
        .limit(1)
      return row ? loadSwitchOperation(db, row.operationId) : null
    },
    async getDefaultSetResultByIdempotencyKey(idempotencyKey: string) {
      const [row] = await db
        .select()
        .from(mnetProfileDefaultSetResults)
        .where(eq(mnetProfileDefaultSetResults.idempotencyKey, idempotencyKey))
        .limit(1)
      return row
        ? {
            operationId: row.operationId,
            policyDecisionId: row.policyDecisionId,
            auditId: row.auditId
          }
        : null
    },
    async recordDefaultSetResult(idempotencyKey: string, result) {
      await db
        .insert(mnetProfileDefaultSetResults)
        .values({
          idempotencyKey,
          operationId: result.operationId,
          policyDecisionId: result.policyDecisionId,
          auditId: result.auditId
        })
        .onConflictDoUpdate({
          target: mnetProfileDefaultSetResults.idempotencyKey,
          set: {
            operationId: result.operationId,
            policyDecisionId: result.policyDecisionId,
            auditId: result.auditId
          }
        })
    },
    async getSwitchOperation(operationId: string) {
      return loadSwitchOperation(db, operationId)
    },
    async getSwitchOperationStatus(operationId: string) {
      const operation = await loadSwitchOperation(db, operationId)
      return operation ? toSwitchStatus(operation) : null
    },
    async startBatch(operationId: string, batchId: number) {
      await db.transaction(async tx => {
        await tx
          .update(mnetProfileSwitchOperations)
          .set({ state: 'applying', currentBatchId: batchId, updatedAt: new Date() })
          .where(eq(mnetProfileSwitchOperations.operationId, operationId))
        await tx
          .update(mnetGlobalDefaults)
          .set({ switchState: 'applying', switchOperationId: operationId, updatedAt: new Date() })
          .where(eq(mnetGlobalDefaults.id, defaultsRowId))
      })
      return loadSwitchOperation(db, operationId)
    },
    async completeBatch(operationId: string, _batchId: number, results) {
      await db.transaction(async tx => {
        for (const result of results) {
          await tx
            .insert(mnetProfileSwitchResults)
            .values({
              operationId,
              networkId: result.networkId,
              previousProfileVersion: result.previousProfileVersion,
              targetProfileVersion: result.targetProfileVersion,
              status: result.status,
              reason: result.reason ?? null,
              auditId: result.auditId ?? null,
              correlationId: result.correlationId ?? null
            })
            .onConflictDoUpdate({
              target: [mnetProfileSwitchResults.operationId, mnetProfileSwitchResults.networkId],
              set: {
                previousProfileVersion: result.previousProfileVersion,
                targetProfileVersion: result.targetProfileVersion,
                status: result.status,
                reason: result.reason ?? null,
                auditId: result.auditId ?? null,
                correlationId: result.correlationId ?? null
              }
            })
        }
        await tx
          .update(mnetProfileSwitchOperations)
          .set({ currentBatchId: null, updatedAt: new Date() })
          .where(eq(mnetProfileSwitchOperations.operationId, operationId))
      })
      return loadSwitchOperation(db, operationId)
    },
    async setSwitchState(operationId: string, state: GlobalSwitchState) {
      const now = new Date()
      await db.transaction(async tx => {
        await tx
          .update(mnetProfileSwitchOperations)
          .set({ state, updatedAt: now })
          .where(eq(mnetProfileSwitchOperations.operationId, operationId))
        await tx
          .update(mnetGlobalDefaults)
          .set({ switchState: state, switchOperationId: operationId, updatedAt: now })
          .where(eq(mnetGlobalDefaults.id, defaultsRowId))
      })
    },
    async getAppliedNetworks(operationId: string) {
      const rows = await db
        .select()
        .from(mnetProfileSwitchResults)
        .where(eq(mnetProfileSwitchResults.operationId, operationId))
      return rows.filter(row => row.status === 'applied').map(row => row.networkId)
    },
    async getMigrationSnapshot(operationId: string) {
      const rows = await db
        .select()
        .from(mnetProfileSwitchSnapshots)
        .where(eq(mnetProfileSwitchSnapshots.operationId, operationId))
      return new Map(rows.map(row => [row.networkId, row.previousProfileVersion]))
    }
  }
}
