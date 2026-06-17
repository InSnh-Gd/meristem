import type {
  GlobalDefaultsStore,
  NetworkProfileMigrationResult,
  SwitchBatch
} from './global-defaults-store.ts'
import type { ProfileStore } from './profile-store.ts'

/** 批量迁移引擎依赖 */
export type MigrationEngineDeps = {
  globalDefaultsStore: GlobalDefaultsStore
  profileStore: ProfileStore
  /** 逐网络上报 Audit 事实 */
  writeAudit: (input: {
    actor: string
    action: string
    resource: string
    result: string
    correlationId: string
    metadata?: unknown
  }) => Promise<string | undefined>
  /** 写 Full Log */
  writeFull: (input: {
    level: string
    message: string
    correlationId: string
    metadata?: unknown
  }) => Promise<void>
}

/** 计划结果 */
export type PlanMigrationResult = {
  operationId: string
  candidateCount: number
  batches: SwitchBatch[]
}

export type MigrationEngine = ReturnType<typeof createMigrationEngine>

/**
 * 批量 Profile 迁移引擎。
 * 不执行 HTTP 或直接文件 I/O，只操作 ProfileStore 和 GlobalDefaultsStore 两个抽象。
 */
export function createMigrationEngine(deps: MigrationEngineDeps) {
  const { globalDefaultsStore, profileStore } = deps

  /**
   * Plan: 扫描所有网络，找出 profileVersion 不等于目标版本的候选网络，
   * 按 batchSize 拆分批次，创建 SwitchOperation。
   */
  async function plan(input: {
    targetProfileVersion: string
    batchSize?: number
    reason: string
    idempotencyKey: string
  }): Promise<{ ok: true; value: PlanMigrationResult } | { ok: false; error: string }> {
    // 幂等性检查
    const existing = await globalDefaultsStore.getSwitchOperationByIdempotencyKey(
      input.idempotencyKey
    )
    if (existing) {
      return {
        ok: true,
        value: {
          operationId: existing.operationId,
          candidateCount: existing.batches.flatMap(b => b.networkIds).length,
          batches: existing.batches
        }
      }
    }

    const defs = await profileStore.getDefinitions()
    const targetDef = defs.find(d => d.profileVersion === input.targetProfileVersion)
    if (!targetDef) {
      return { ok: false, error: `unknown target profile version: ${input.targetProfileVersion}` }
    }

    // 扫描候选网络
    const allStates = await profileStore.listNetworkStates()
    const candidates = allStates.filter(s => s.profileVersion !== input.targetProfileVersion)

    const batchSize = Math.max(1, input.batchSize ?? 10)
    const batchList: string[][] = []
    for (let i = 0; i < candidates.length; i += batchSize) {
      batchList.push(candidates.slice(i, i + batchSize).map(c => c.networkId))
    }

    const batches: SwitchBatch[] = batchList.map((networkIds, idx) => ({
      batchId: idx + 1,
      networkIds
    }))

    return {
      ok: true,
      value: await createOperation(input, batches)
    }
  }

  async function createOperation(
    input: {
      targetProfileVersion: string
      batchSize?: number
      reason: string
      idempotencyKey: string
    },
    batches: SwitchBatch[]
  ): Promise<PlanMigrationResult> {
    const batchSize = Math.max(1, input.batchSize ?? 10)
    const op = await globalDefaultsStore.createSwitchOperation({
      idempotencyKey: input.idempotencyKey,
      targetProfileVersion: input.targetProfileVersion,
      batchSize,
      reason: input.reason,
      batches
    })

    const candidateCount = batches.flatMap(b => b.networkIds).length

    await deps.writeFull({
      level: 'info',
      message: `profile switch planned: ${candidateCount} networks, ${batches.length} batches`,
      correlationId: op.operationId,
      metadata: {
        targetProfileVersion: input.targetProfileVersion,
        batchSize: input.batchSize,
        candidateCount,
        batchCount: batches.length
      }
    })

    return {
      operationId: op.operationId,
      candidateCount,
      batches
    }
  }

  /**
   * Apply: 处理下一批未完成的 batch。
   */
  async function apply(
    operationId: string,
    actor: string
  ): Promise<
    | {
        ok: true
        value: {
          operationId: string
          batchId: number
          results: NetworkProfileMigrationResult[]
          isComplete: boolean
        }
      }
    | { ok: false; error: string }
  > {
    const op = await globalDefaultsStore.getSwitchOperation(operationId)
    if (!op) return { ok: false, error: 'switch operation not found' }

    // 找到下一个未完成的 batch
    const nextBatch = op.batches.find(b => !op.completedBatchIds.includes(b.batchId))
    if (!nextBatch) {
      // 所有 batch 已完成
      await globalDefaultsStore.setSwitchState(operationId, 'applied')
      return {
        ok: true,
        value: {
          operationId,
          batchId: -1,
          results: [],
          isComplete: true
        }
      }
    }

    await globalDefaultsStore.startBatch(operationId, nextBatch.batchId)

    const correlationId = crypto.randomUUID()
    const results: NetworkProfileMigrationResult[] = []

    for (const networkId of nextBatch.networkIds) {
      const state = await profileStore.getNetworkState(networkId)

      if (!state) {
        // 网络不存在，跳过
        const result: NetworkProfileMigrationResult = {
          networkId,
          previousProfileVersion: 'unknown',
          targetProfileVersion: op.targetProfileVersion,
          status: 'skipped',
          reason: 'network not found',
          correlationId
        }
        results.push(result)
        continue
      }

      if (state.profileVersion === op.targetProfileVersion) {
        // 已经是目标版本，跳过
        const skipResult: NetworkProfileMigrationResult = {
          networkId,
          previousProfileVersion: state.profileVersion,
          targetProfileVersion: op.targetProfileVersion,
          status: 'skipped',
          reason: 'already at target version',
          correlationId
        }
        results.push(skipResult)
        continue
      }

      const auditId = crypto.randomUUID()
      await deps.writeAudit({
        actor,
        action: 'mnet.profile.switch.apply',
        resource: `network:${networkId}`,
        result: 'applied',
        correlationId: auditId,
        metadata: {
          fromVersion: state.profileVersion,
          toVersion: op.targetProfileVersion,
          operationId
        }
      })

      try {
        // 应用 profile 变更
        await profileStore.setNetworkState(networkId, {
          profileVersion: op.targetProfileVersion,
          status: 'enabled'
        })

        await profileStore.recordTransition({
          networkId,
          fromVersion: state.profileVersion,
          toVersion: op.targetProfileVersion,
          fromStatus: state.status,
          toStatus: 'enabled',
          actor,
          reason: `batch migration: ${op.reason}`,
          correlationId
        })

        const applyResult: NetworkProfileMigrationResult = {
          networkId,
          previousProfileVersion: state.profileVersion,
          targetProfileVersion: op.targetProfileVersion,
          status: 'applied',
          auditId,
          correlationId
        }
        results.push(applyResult)
      } catch {
        const failResult: NetworkProfileMigrationResult = {
          networkId,
          previousProfileVersion: state.profileVersion,
          targetProfileVersion: op.targetProfileVersion,
          status: 'failed',
          reason: 'internal error during apply',
          correlationId
        }
        results.push(failResult)
      }
    }

    await globalDefaultsStore.completeBatch(operationId, nextBatch.batchId, results)

    const remainingBatches = op.batches.filter(
      b => !op.completedBatchIds.includes(b.batchId) && b.batchId !== nextBatch.batchId
    )

    const isComplete = remainingBatches.length === 0
    if (isComplete) {
      await globalDefaultsStore.setSwitchState(operationId, 'applied')
    }

    await deps.writeFull({
      level: 'info',
      message: `batch ${nextBatch.batchId} applied: ${results.length} networks`,
      correlationId,
      metadata: { batchId: nextBatch.batchId, results }
    })

    return {
      ok: true,
      value: {
        operationId,
        batchId: nextBatch.batchId,
        results,
        isComplete
      }
    }
  }

  /**
   * Resume: 找到下一个未处理的 batch，继续 apply。
   */
  async function resume(
    operationId: string,
    actor: string
  ): Promise<
    | {
        ok: true
        value: {
          operationId: string
          nextBatchId: number | null
          remainingBatches: number
          isComplete: boolean
        }
      }
    | { ok: false; error: string }
  > {
    const op = await globalDefaultsStore.getSwitchOperation(operationId)
    if (!op) return { ok: false, error: 'switch operation not found' }

    const nextBatch = op.batches.find(b => !op.completedBatchIds.includes(b.batchId))
    if (!nextBatch) {
      await globalDefaultsStore.setSwitchState(operationId, 'applied')
      return {
        ok: true,
        value: {
          operationId,
          nextBatchId: null,
          remainingBatches: 0,
          isComplete: true
        }
      }
    }

    // 调用 apply 处理下一个 batch
    const applyResult = await apply(operationId, actor)
    if (!applyResult.ok) return applyResult

    const remainingBatches =
      op.batches.filter(b => !op.completedBatchIds.includes(b.batchId)).length - 1

    return {
      ok: true,
      value: {
        operationId,
        nextBatchId: applyResult.value.batchId,
        remainingBatches: Math.max(0, remainingBatches),
        isComplete: applyResult.value.isComplete
      }
    }
  }

  /**
   * Rollback: 恢复已迁移网络到迁移前的 profile 版本。
   */
  async function rollback(
    operationId: string,
    actor: string,
    reason?: string
  ): Promise<
    | { ok: true; value: { operationId: string; rollbackResults: NetworkProfileMigrationResult[] } }
    | { ok: false; error: string }
  > {
    const op = await globalDefaultsStore.getSwitchOperation(operationId)
    if (!op) return { ok: false, error: 'switch operation not found' }

    const snapshot = await globalDefaultsStore.getMigrationSnapshot(operationId)
    const rollbackResults: NetworkProfileMigrationResult[] = []
    const correlationId = crypto.randomUUID()

    const appliedNetworks = await globalDefaultsStore.getAppliedNetworks(operationId)

    for (const networkId of appliedNetworks) {
      const previousVersion = snapshot.get(networkId) ?? 'm-net-default@0.1.0'

      await deps.writeAudit({
        actor,
        action: 'mnet.profile.switch.rollback',
        resource: `network:${networkId}`,
        result: 'rolled_back',
        correlationId,
        metadata: {
          fromVersion: op.targetProfileVersion,
          toVersion: previousVersion,
          operationId
        }
      })

      // 还原到迁移前版本
      await profileStore.setNetworkState(networkId, {
        profileVersion: previousVersion,
        status: 'disabled'
      })

      await profileStore.recordTransition({
        networkId,
        fromVersion: op.targetProfileVersion,
        toVersion: previousVersion,
        fromStatus: 'enabled',
        toStatus: 'disabled',
        actor,
        reason: reason ?? 'batch migration rollback',
        correlationId
      })

      rollbackResults.push({
        networkId,
        previousProfileVersion: op.targetProfileVersion,
        targetProfileVersion: previousVersion,
        status: 'rolled_back',
        correlationId
      })
    }

    await globalDefaultsStore.setSwitchState(operationId, 'rolled_back')

    await deps.writeFull({
      level: 'info',
      message: `profile switch rollback: ${rollbackResults.length} networks restored`,
      correlationId,
      metadata: { operationId, rollbackResults }
    })

    return {
      ok: true,
      value: {
        operationId,
        rollbackResults
      }
    }
  }

  return { plan, apply, resume, rollback }
}
