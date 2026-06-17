export type MNetServiceError = {
  code: string
  message: string
}

export type MNetServiceResult<T> = { ok: true; value: T } | { ok: false; error: MNetServiceError }

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
