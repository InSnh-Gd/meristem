import type { Result } from '../../../../packages/common/src/result.ts'
import type {
  ActorId,
  ApprovalDetailResponse,
  ApprovalListResponse,
  MNetRegionalProfile,
  Permission
} from '../../../../packages/contracts/src/index.ts'
import type { ServiceError } from './common.ts'

export type ReaderContext = {
  actor: ActorId
  bearerToken: string
  correlationId: string
}

/**
 * ApprovalReaderPort 只读 M-Policy 的公开审批 API，Core 不持有审批状态。
 */
export type ApprovalReaderPort = {
  requiredPermission: Permission
  list(context: ReaderContext): Promise<Result<ApprovalListResponse, ServiceError>>
  get(
    id: string,
    context: ReaderContext
  ): Promise<Result<ApprovalDetailResponse | null, ServiceError>>
}

/**
 * NetworkProfileReaderPort 只读 M-Net 的公开 profile API，Core 不读取 M-Net 私有 store。
 */
export type NetworkProfileReaderPort = {
  requiredPermission: Permission
  list(context: ReaderContext): Promise<Result<{ profiles: MNetRegionalProfile[] }, ServiceError>>
  get(
    profileVersion: string,
    context: ReaderContext
  ): Promise<Result<MNetRegionalProfile | null, ServiceError>>
}
