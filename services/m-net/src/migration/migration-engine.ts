export type { PlanMigrationResult } from './migration-engine-types.ts'

import { applyNetwork } from './migration-engine-application.ts'
import type { MigrationEngine } from './migration-engine-contract.ts'
import { isCandidate } from './migration-engine-helpers.ts'
import { fail, ok } from './migration-engine-locks.ts'
import { rollbackNetwork } from './migration-engine-rollback.ts'
import { type MigrationEngineDeps, TARGET_CN_PROFILE_VERSION } from './migration-engine-types.ts'

export type { MigrationEngineDeps, SwitchOperationStatus } from './migration-engine-types.ts'
export { TARGET_CN_PROFILE_VERSION } from './migration-engine-types.ts'

import type {
  NetworkProfileMigrationResult,
  SwitchBatch
} from '../profile/global-defaults-store.ts'
import type { NetworkSnapshot } from './migration-engine-helpers.ts'

// 显式接口定义在 migration-engine-contract.ts 叶模块；此处仅 re-export 以保持既有导入点兼容，
// 并让返回值显式标注为 MigrationEngine（DFW-041：避免 ReturnType 派生类型把实现拉进 deps.ts 闭包）。
export type { MigrationEngine } from './migration-engine-contract.ts'

export function createMigrationEngine(deps: MigrationEngineDeps): MigrationEngine {
  async function plan(input: {
    targetProfileVersion: string
    batchSize?: number
    reason: string
    idempotencyKey: string
  }) {
    const existing = await deps.globalDefaultsStore.getSwitchOperationByIdempotencyKey(
      input.idempotencyKey
    )
    if (existing) {
      const status = await deps.globalDefaultsStore.getSwitchOperationStatus(existing.operationId)
      return ok({
        operationId: existing.operationId,
        candidateCount:
          status?.candidateCount ?? existing.batches.flatMap(batch => batch.networkIds).length,
        candidates: status ? flatten(existing.batches) : flatten(existing.batches),
        batches: existing.batches
      })
    }
    const defs = await deps.profileStore.getDefinitions()
    const targetDef = defs.find(def => def.profileVersion === input.targetProfileVersion)
    if (!targetDef) return fail(`unknown target profile version: ${input.targetProfileVersion}`)
    const candidates = (await deps.profileStore.listNetworkStates()).filter(state =>
      isCandidate(state, input.targetProfileVersion)
    )
    const batchSize = Math.max(1, input.batchSize ?? 10)
    const batches = toBatches(candidates, batchSize)
    const operation = await deps.globalDefaultsStore.createSwitchOperation({
      idempotencyKey: input.idempotencyKey,
      targetProfileVersion: input.targetProfileVersion,
      batchSize,
      reason: input.reason,
      batches
    })
    await deps.writeFull({
      level: 'info',
      message: `profile switch planned: ${candidates.length} networks`,
      correlationId: operation.operationId,
      metadata: {
        targetProfileVersion: input.targetProfileVersion,
        reason: input.reason,
        batches
      }
    })
    await deps.writeTimeline?.({
      summary: `planned profile migration ${operation.operationId}`,
      subject: 'mnet.profile.migration.plan',
      correlationId: operation.operationId
    })
    return ok({
      operationId: operation.operationId,
      candidateCount: candidates.length,
      candidates: candidates.map(candidate => candidate.networkId),
      batches
    })
  }

  async function getStatus(operationId: string) {
    const status = await deps.globalDefaultsStore.getSwitchOperationStatus(operationId)
    return status ? ok(status) : fail('switch operation not found')
  }

  async function apply(operationId: string, actor: string) {
    const operation = await deps.globalDefaultsStore.getSwitchOperation(operationId)
    if (!operation) return fail('switch operation not found')
    const nextBatch = operation.batches.find(
      batch => !operation.completedBatchIds.includes(batch.batchId)
    )
    if (!nextBatch) {
      await deps.globalDefaultsStore.setSwitchState(operationId, 'applied')
      return ok({ operationId, batchId: -1, results: [], isComplete: true })
    }
    await deps.globalDefaultsStore.startBatch(operationId, nextBatch.batchId)
    const results = await Promise.all(
      nextBatch.networkIds.map(networkId =>
        applyNetwork(deps, {
          operation,
          networkId,
          actor,
          batchId: nextBatch.batchId
        })
      )
    )
    await deps.globalDefaultsStore.completeBatch(operationId, nextBatch.batchId, results)
    const status = await deps.globalDefaultsStore.getSwitchOperationStatus(operationId)
    const isComplete = Boolean(status && status.completedBatchIds.length === status.batches.length)
    await deps.globalDefaultsStore.setSwitchState(operationId, isComplete ? 'applied' : 'applying')
    await deps.writeFull({
      level: 'info',
      message: `profile switch batch ${nextBatch.batchId} applied`,
      correlationId: operationId,
      metadata: { batchId: nextBatch.batchId, results }
    })
    await deps.writeTimeline?.({
      summary: `applied profile migration batch ${nextBatch.batchId}`,
      subject: 'mnet.profile.migration.apply',
      correlationId: operationId
    })
    return ok({ operationId, batchId: nextBatch.batchId, results, isComplete })
  }

  async function resume(operationId: string, actor: string) {
    const applied = await apply(operationId, actor)
    if (!applied.ok) return applied
    const status = await deps.globalDefaultsStore.getSwitchOperationStatus(operationId)
    if (!status) return fail('switch operation not found')
    const nextBatch = status.batches.find(
      batch => !status.completedBatchIds.includes(batch.batchId)
    )
    return ok({
      operationId,
      nextBatchId: nextBatch?.batchId ?? null,
      remainingBatches: status.batches.length - status.completedBatchIds.length,
      isComplete: applied.value.isComplete
    })
  }

  async function rollback(operationId: string, actor: string, reason?: string) {
    const operation = await deps.globalDefaultsStore.getSwitchOperation(operationId)
    if (!operation) return fail('switch operation not found')
    const snapshot = await deps.globalDefaultsStore.getMigrationSnapshot(operationId)
    const rollbackResults: NetworkProfileMigrationResult[] = []
    for (const networkId of await deps.globalDefaultsStore.getAppliedNetworks(operationId)) {
      rollbackResults.push(
        await rollbackNetwork(deps, {
          operationId,
          operation,
          networkId,
          actor,
          ...(reason !== undefined ? { reason } : {}),
          snapshot
        })
      )
    }
    await deps.globalDefaultsStore.setSwitchState(operationId, 'rolled_back')
    await deps.writeFull({
      level: 'info',
      message: `profile switch rollback: ${rollbackResults.length} networks restored`,
      correlationId: operationId,
      metadata: { rollbackResults }
    })
    await deps.writeTimeline?.({
      summary: `rolled back profile migration ${operationId}`,
      subject: 'mnet.profile.migration.rollback',
      correlationId: operationId
    })
    return ok({ operationId, rollbackResults })
  }

  async function migrateNetwork(input: {
    networkId: string
    actor: string
    reason: string
    operationId?: string
    targetProfileVersion?: string
    targetStatus?: 'enabled' | 'enabling'
  }) {
    const operationId = input.operationId ?? `mnet-migration-${crypto.randomUUID()}`
    const result = await applyNetwork(deps, {
      operation: {
        operationId,
        targetProfileVersion: input.targetProfileVersion ?? TARGET_CN_PROFILE_VERSION,
        reason: input.reason
      },
      networkId: input.networkId,
      actor: input.actor,
      batchId: 1,
      ...(input.targetStatus !== undefined ? { targetStatus: input.targetStatus } : {})
    })
    return ok({ operationId, result })
  }

  async function rollbackSingleNetwork(input: {
    operationId: string
    networkId: string
    actor: string
    reason: string
    sourceProfileVersion: string
    targetProfileVersion: string
  }) {
    const result = await rollbackNetwork(deps, {
      operationId: input.operationId,
      operation: { targetProfileVersion: input.targetProfileVersion },
      networkId: input.networkId,
      actor: input.actor,
      reason: input.reason,
      snapshot: new Map([[input.networkId, input.sourceProfileVersion]])
    })
    return ok({ operationId: input.operationId, result })
  }

  return { plan, getStatus, apply, resume, rollback, migrateNetwork, rollbackSingleNetwork }
}

function toBatches(candidates: readonly NetworkSnapshot[], batchSize: number): SwitchBatch[] {
  const batches: SwitchBatch[] = []
  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push({
      batchId: batches.length + 1,
      networkIds: candidates.slice(index, index + batchSize).map(c => c.networkId)
    })
  }
  return batches
}

function flatten(batches: readonly SwitchBatch[]): string[] {
  return batches.flatMap(batch => batch.networkIds)
}
