import type { ProfileStore } from './profile-store.ts'

/** 全局 switch 状态 */
export type GlobalSwitchState =
  | 'idle'
  | 'planned'
  | 'applying'
  | 'applied'
  | 'rolled_back'
  | 'failed'

/** 批量迁移操作记录 */
export type SwitchOperation = {
  operationId: string
  idempotencyKey: string
  targetProfileVersion: string
  batchSize: number
  reason: string
  state: GlobalSwitchState
  /** 已完成的 batchId 列表 */
  completedBatchIds: number[]
  /** 当前正在处理的 batchId */
  currentBatchId: number | null
  /** 迁移计划批次 */
  batches: SwitchBatch[]
  /** 逐网络结果记录 */
  results: NetworkProfileMigrationResult[]
  createdAt: string
  updatedAt: string
}

export type SwitchBatch = {
  batchId: number
  networkIds: string[]
}

/** 单条网络迁移结果 */
export type NetworkProfileMigrationResult = {
  networkId: string
  previousProfileVersion: string
  targetProfileVersion: string
  status: 'applied' | 'skipped' | 'failed' | 'rolled_back' | 'pending'
  reason?: string
  auditId?: string
  correlationId?: string
}

export type SwitchOperationStatus = {
  operationId: string
  targetProfileVersion: string
  reason: string
  batchSize: number
  candidateCount: number
  batches: SwitchBatch[]
  completedBatchIds: number[]
  currentBatchId: number | null
  results: NetworkProfileMigrationResult[]
  globalSwitchState: GlobalSwitchState
  createdAt: string
  updatedAt: string
}

/** 全局默认值存储端口 */
export type GlobalDefaultsStore = {
  /** 获取全局默认 profile 版本 */
  getDefaultProfileVersion(): Promise<string>

  /** 设置全局默认 profile 版本 */
  setDefaultProfileVersion(profileVersion: string): Promise<void>

  /** 获取全局 switch 状态和当前操作 ID */
  getSwitchState(): Promise<{
    state: GlobalSwitchState
    switchOperationId: string | undefined
    updatedAt: string
  }>

  /** 创建新的 switch 操作（plan 阶段） */
  createSwitchOperation(input: {
    idempotencyKey: string
    targetProfileVersion: string
    batchSize: number
    reason: string
    batches: SwitchBatch[]
  }): Promise<SwitchOperation>

  /** 根据 idempotencyKey 查找已存在的 switch 操作 */
  getSwitchOperationByIdempotencyKey(idempotencyKey: string): Promise<SwitchOperation | null>

  /** 根据 idempotencyKey 查找已执行的默认设置操作结果 */
  getDefaultSetResultByIdempotencyKey(idempotencyKey: string): Promise<{
    operationId: string
    policyDecisionId: string
    auditId: string
    defaultProfileVersion?: string
    migrationOperationId?: string
  } | null>

  /** 记录默认设置操作的幂等结果 */
  recordDefaultSetResult(
    idempotencyKey: string,
    result: {
      operationId: string
      policyDecisionId: string
      auditId: string
      defaultProfileVersion?: string
      migrationOperationId?: string
    }
  ): Promise<void>

  /** 根据 operationId 获取 switch 操作 */
  getSwitchOperation(operationId: string): Promise<SwitchOperation | null>

  /** 读取单个 switch 操作的展示态。 */
  getSwitchOperationStatus(operationId: string): Promise<SwitchOperationStatus | null>

  /** 开始处理下一个 batch */
  startBatch(operationId: string, batchId: number): Promise<SwitchOperation | null>

  /** 完成一个 batch */
  completeBatch(
    operationId: string,
    batchId: number,
    results: NetworkProfileMigrationResult[]
  ): Promise<SwitchOperation | null>

  /** 标记操作状态（如 applied / failed / rolled_back） */
  setSwitchState(operationId: string, state: GlobalSwitchState): Promise<void>

  /** 获取已应用网络列表（用于回滚） */
  getAppliedNetworks(operationId: string): Promise<string[]>

  /** 获取迁移快照：迁移前的 profile 版本（用于回滚恢复） */
  getMigrationSnapshot(operationId: string): Promise<Map<string, string>>
}

/**
 * 创建内存全局默认值存储适配器，用于单元测试和契约测试。
 */
export function createInMemoryGlobalDefaultsStore(profileStore: ProfileStore): GlobalDefaultsStore {
  let defaultProfileVersion = 'm-net@0.3.0'
  let switchState: GlobalSwitchState = 'idle'
  let switchOperationId: string | undefined
  let updatedAt = new Date().toISOString()
  const operations = new Map<string, SwitchOperation>()

  /** 默认设置幂等记录：idempotencyKey → 结果 */
  const defaultSetResults = new Map<
    string,
    {
      operationId: string
      policyDecisionId: string
      auditId: string
      defaultProfileVersion?: string
      migrationOperationId?: string
    }
  >()

  /** 迁移快照：operationId → (networkId → 迁移前的 profileVersion) */
  const migrationSnapshots = new Map<string, Map<string, string>>()

  function touch() {
    updatedAt = new Date().toISOString()
  }

  return {
    async getDefaultProfileVersion() {
      return defaultProfileVersion
    },

    async setDefaultProfileVersion(profileVersion: string) {
      defaultProfileVersion = profileVersion
      touch()
    },

    async getSwitchState() {
      return { state: switchState, switchOperationId, updatedAt }
    },

    async createSwitchOperation(input) {
      touch()
      const operationId = `mnet-migration-${crypto.randomUUID()}`
      switchOperationId = operationId
      switchState = 'planned'

      const op: SwitchOperation = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        targetProfileVersion: input.targetProfileVersion,
        batchSize: input.batchSize,
        reason: input.reason,
        state: 'planned',
        completedBatchIds: [],
        currentBatchId: null,
        batches: input.batches,
        results: [],
        createdAt: updatedAt,
        updatedAt
      }
      operations.set(operationId, op)

      // 创建迁移快照
      const snapshot = new Map<string, string>()
      for (const batch of input.batches) {
        for (const networkId of batch.networkIds) {
          const state = await profileStore.getNetworkState(networkId)
          snapshot.set(networkId, state?.profileVersion ?? 'm-net@0.3.0')
        }
      }
      migrationSnapshots.set(operationId, snapshot)

      return op
    },

    async getSwitchOperationByIdempotencyKey(idempotencyKey: string) {
      for (const op of operations.values()) {
        if (op.idempotencyKey === idempotencyKey) return op
      }
      return null
    },

    async getDefaultSetResultByIdempotencyKey(idempotencyKey: string) {
      return defaultSetResults.get(idempotencyKey) ?? null
    },

    async recordDefaultSetResult(idempotencyKey: string, result) {
      defaultSetResults.set(idempotencyKey, result)
    },

    async getSwitchOperation(operationId: string) {
      return operations.get(operationId) ?? null
    },

    async getSwitchOperationStatus(operationId: string) {
      const op = operations.get(operationId)
      if (!op) return null
      return {
        operationId: op.operationId,
        targetProfileVersion: op.targetProfileVersion,
        reason: op.reason,
        batchSize: op.batchSize,
        candidateCount: op.batches.flatMap(batch => batch.networkIds).length,
        batches: op.batches.map(batch => ({ ...batch, networkIds: [...batch.networkIds] })),
        completedBatchIds: [...op.completedBatchIds],
        currentBatchId: op.currentBatchId,
        results: op.results.map(result => ({ ...result })),
        globalSwitchState: op.state,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt
      }
    },

    async startBatch(operationId: string, batchId: number) {
      const op = operations.get(operationId)
      if (!op) return null

      op.currentBatchId = batchId
      op.state = 'applying'
      switchState = 'applying'
      op.updatedAt = new Date().toISOString()
      touch()
      return op
    },

    async completeBatch(
      operationId: string,
      batchId: number,
      results: NetworkProfileMigrationResult[]
    ) {
      const op = operations.get(operationId)
      if (!op) return null

      op.completedBatchIds.push(batchId)
      op.results.push(...results)
      op.currentBatchId = null
      op.updatedAt = new Date().toISOString()
      touch()
      return op
    },

    async setSwitchState(operationId: string, state: GlobalSwitchState) {
      const op = operations.get(operationId)
      if (!op) return

      op.state = state
      switchState = state
      op.updatedAt = new Date().toISOString()
      touch()
    },

    async getAppliedNetworks(operationId: string) {
      const op = operations.get(operationId)
      if (!op) return []
      return op.results.filter(r => r.status === 'applied').map(r => r.networkId)
    },

    async getMigrationSnapshot(operationId: string) {
      return migrationSnapshots.get(operationId) ?? new Map()
    }
  }
}
