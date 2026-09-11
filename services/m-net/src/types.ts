import type { createDb } from '../../../packages/db/src/client.ts'
import type { Result } from '../../../packages/common/src/result.ts'

export type MNetServiceError = {
  code: string
  message: string
}

export type MNetServiceResult<T> = Result<T, MNetServiceError>

/**
 * M-Net 的 PostgreSQL 客户端类型。定义在叶模块（仅依赖 packages/db）而非 clients.ts，
 * 以便 deps.ts 引用时不必反向依赖 clients.ts，从而断开 DFW-041 的依赖环。
 */
export type MNetDb = ReturnType<typeof createDb>['db']
export type MNetSqlClient = ReturnType<typeof createDb>['client']

/** 节点运行期公钥注册成功结果。叶模块定义，避免 deps.ts 依赖 mnet-dataplane-support.ts。 */
export type NodeKeyRegistrationSuccess = {
  nodeId: string
  keyId: string
  fingerprint: string
  mapVersion: number
  correlationId: string
}

/** forced-relay proof path 所需的节点上下文。叶模块定义，避免 deps.ts 依赖查询实现。 */
export type ForcedRelayNodeContext = {
  nodeId: string
  nodeKind: 'stem' | 'leaf'
  status: string
  reachability: string
  capabilities: string[]
  networkId: string | null
  networkProfileVersion: string | null
}

/**
 * Break-glass 紧急禁用请求体。
 * approvalDegraded 字段仅供服务端检测使用——客户端传值将被忽略。
 */
export type DisableBreakGlassRequest = {
  emergencyReason: string
  /** 客户端不可信——服务端自行检测审批降级 */
  approvalDegraded?: boolean
}

/**
 * Break-glass 禁用响应体。
 */
export type DisableBreakGlassResponse = {
  operationId: string
  profileVersion: string
  status: 'disabled'
  approvalDegraded: boolean
  degradationSource?: string
  auditId: string
  fullLogId: string
  correlationId: string
}

/**
 * Profile 禁用审批策略配置请求体。
 */
export type SetProfileDisablePolicyRequest = {
  requireApproval: boolean
  emergencyBreakGlassEnabled: boolean
  reason: string
  idempotencyKey: string
}
