import type { Result } from '../../../../packages/common/src/result.ts'
import type { ActorId, ApprovalActionResponse } from '../../../../packages/contracts/src/index.ts'
import type { ServiceError } from './common.ts'

/** WriterContext 与 ReaderContext 保持相同结构，Core 路由透传 actor + token + correlationId 到下游 */
export type WriterContext = {
  actor: ActorId
  bearerToken: string
  correlationId: string
}

/** M-Net profile 写请求体，Core 透传到 POST /api/v0/networks/:id/profile */
export type ProfileWriteRequest = {
  profileVersion: string
  reason: string
}

/** M-Net 返回的 profile 写响应联合类型 */
export type ProfileWriteResponse =
  | {
      status: 'pending_approval'
      operationId: string
      approvalId?: string
      correlationId: string
    }
  | {
      status: 'disabled'
      profileVersion: string
      correlationId: string
    }

/**
 * ApprovalWriterPort 对应 M-Policy 公开 POST /api/v0/policy/approvals/:id/approve 和
 * POST /api/v0/policy/approvals/:id/reject 的 HTTP 契约。
 * Core 仅做认证、授权与错误收敛，实际投票仍由 M-Policy 处理。
 */
export type ApprovalWriterPort = {
  approve(
    id: string,
    body: { reason?: string },
    context: WriterContext
  ): Promise<Result<ApprovalActionResponse, ServiceError>>
  reject(
    id: string,
    body: { reason?: string },
    context: WriterContext
  ): Promise<Result<ApprovalActionResponse, ServiceError>>
}

/**
 * NetworkProfileWriterPort 对应 M-Net 公开 POST /api/v0/networks/:id/profile 的 HTTP 契约。
 * Core 仅做认证、授权与错误收敛，真实状态转换仍由 M-Net 处理。
 */
export type NetworkProfileWriterPort = {
  setProfile(
    networkId: string,
    body: ProfileWriteRequest,
    context: WriterContext
  ): Promise<Result<ProfileWriteResponse, ServiceError>>
}
