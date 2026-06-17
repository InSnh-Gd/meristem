import type { Result } from '../../../../packages/common/src/result.ts'
import type { Permission } from '../../../../packages/contracts/src/index.ts'
import type { ServiceError } from './common.ts'

export type GlobalDefaultsContext = {
  actor: string
  bearerToken: string
  correlationId: string
}

/** GET /api/v0/networks/profile-defaults 响应 */
export type ProfileDefaultsResponse = {
  defaultProfileVersion: string
  globalSwitchState: 'idle' | 'planned' | 'applying' | 'applied' | 'rolled_back' | 'failed'
  updatedAt: string
  switchOperationId?: string
}

/** PUT /api/v0/networks/profile-defaults 响应 */
export type SetProfileDefaultsResponse = {
  operationId: string
  policyDecisionId: string
  auditId: string
  defaultProfileVersion: string
}

/** 单条网络迁移结果 */
export type NetworkProfileMigrationResult = {
  networkId: string
  previousProfileVersion: string
  targetProfileVersion: string
  status: 'applied' | 'skipped' | 'failed' | 'rolled_back'
  reason?: string
  auditId?: string
  correlationId?: string
}

/** POST /api/v0/networks/profile-switches/plan 响应 */
export type PlanSwitchResponse = {
  operationId: string
  candidateCount: number
  batches: Array<{ batchId: number; networkIds: string[] }>
  globalSwitchState: 'planned'
}

/** POST /api/v0/networks/profile-switches/:id/apply 响应 */
export type ApplySwitchResponse = {
  operationId: string
  batchId: number
  results: NetworkProfileMigrationResult[]
  globalSwitchState: 'applied' | 'applying'
}

/** POST /api/v0/networks/profile-switches/:id/resume 响应 */
export type ResumeSwitchResponse = {
  operationId: string
  nextBatchId: number | null
  globalSwitchState: 'applying' | 'applied'
  remainingBatches: number
}

/** POST /api/v0/networks/profile-switches/:id/rollback 响应 */
export type RollbackSwitchResponse = {
  operationId: string
  rollbackResults: NetworkProfileMigrationResult[]
  globalSwitchState: 'rolled_back'
}

/**
 * GlobalDefaultsReaderPort 只读全局默认 Profile 状态，Core 不持有 M-Net 私有 store。
 */
export type GlobalDefaultsReaderPort = {
  requiredPermission: Permission
  getDefaults(
    context: GlobalDefaultsContext
  ): Promise<Result<ProfileDefaultsResponse, ServiceError>>
}

/**
 * GlobalDefaultsWriterPort 写全局默认 Profile 设置。
 */
export type GlobalDefaultsWriterPort = {
  requiredPermission: Permission
  setDefaults(
    body: { profileVersion: string; reason: string; idempotencyKey: string },
    context: GlobalDefaultsContext
  ): Promise<Result<SetProfileDefaultsResponse, ServiceError>>
}

/**
 * ProfileSwitchWriterPort 批量迁移规划、应用、恢复、回滚的写端口。
 */
export type ProfileSwitchWriterPort = {
  planPermission: Permission
  applyPermission: Permission
  resumePermission: Permission
  rollbackPermission: Permission
  plan(
    body: {
      targetProfileVersion: string
      batchSize?: number
      reason: string
      idempotencyKey: string
    },
    context: GlobalDefaultsContext
  ): Promise<Result<PlanSwitchResponse, ServiceError>>
  apply(
    operationId: string,
    context: GlobalDefaultsContext
  ): Promise<Result<ApplySwitchResponse, ServiceError>>
  resume(
    operationId: string,
    context: GlobalDefaultsContext
  ): Promise<Result<ResumeSwitchResponse, ServiceError>>
  rollback(
    operationId: string,
    body: { reason?: string },
    context: GlobalDefaultsContext
  ): Promise<Result<RollbackSwitchResponse, ServiceError>>
}
