import type {
  NetworkProfileMigrationResult,
  SwitchBatch,
  SwitchOperationStatus
} from '../profile/global-defaults-store.ts'
import type { PlanMigrationResult } from './migration-engine-types.ts'

/**
 * Profile 迁移引擎的显式接口，定义在叶模块中。
 *
 * 为什么不用 `ReturnType<typeof createMigrationEngine>`：value 派生类型会把
 * `migration-engine.ts` 的实现（及其经 migration-engine-locks → data-plane-security-support
 * → profile-workflow-types 的传递依赖）拉进 `deps.ts` 的引用闭包，重新形成 DFW-041 的依赖环。
 * 显式接口只依赖 global-defaults-store / migration-engine-types（均不反向依赖 deps.ts），
 * 因此 `deps.ts` 引用它不再回到自身。
 */

/** 迁移引擎的成功结果。 */
export type MigrationOperationOk<T> = { ok: true; value: T }

/** 迁移引擎的失败结果（错误以字符串原因表示）。 */
export type MigrationOperationFailure = { ok: false; error: string }

export type MigrationOperationResult<T> = MigrationOperationOk<T> | MigrationOperationFailure

export type MigrationApplyResult = {
  operationId: string
  batchId: number
  results: NetworkProfileMigrationResult[]
  isComplete: boolean
}

export type MigrationResumeResult = {
  operationId: string
  nextBatchId: number | null
  remainingBatches: number
  isComplete: boolean
}

export type MigrationRollbackResult = {
  operationId: string
  rollbackResults: NetworkProfileMigrationResult[]
}

export type MigrationEngine = {
  plan(input: {
    targetProfileVersion: string
    batchSize?: number
    reason: string
    idempotencyKey: string
  }): Promise<MigrationOperationResult<PlanMigrationResult>>
  getStatus(operationId: string): Promise<MigrationOperationResult<SwitchOperationStatus>>
  apply(operationId: string, actor: string): Promise<MigrationOperationResult<MigrationApplyResult>>
  resume(
    operationId: string,
    actor: string
  ): Promise<MigrationOperationResult<MigrationResumeResult>>
  rollback(
    operationId: string,
    actor: string,
    reason?: string
  ): Promise<MigrationOperationResult<MigrationRollbackResult>>
  migrateNetwork(input: {
    networkId: string
    actor: string
    reason: string
    operationId?: string
    targetProfileVersion?: string
    targetStatus?: 'enabled' | 'enabling'
  }): Promise<
    MigrationOperationResult<{ operationId: string; result: NetworkProfileMigrationResult }>
  >
  rollbackSingleNetwork(input: {
    operationId: string
    networkId: string
    actor: string
    reason: string
    sourceProfileVersion: string
    targetProfileVersion: string
  }): Promise<
    MigrationOperationResult<{ operationId: string; result: NetworkProfileMigrationResult }>
  >
}

// SwitchBatch 目前在引擎内部经 toBatches 使用；在此 re-export 保持与 migration-engine-types 的一致性。
export type { NetworkProfileMigrationResult, SwitchBatch, SwitchOperationStatus }
