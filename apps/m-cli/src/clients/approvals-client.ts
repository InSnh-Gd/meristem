import type {
  ApprovalActionResponse,
  ApprovalDetailResponse,
  ApprovalListResponse
} from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 审批客户端直接调用 M-Policy 外部审批 API，不经过 Core 转发。
 */
export function createApprovalsClient(
  runtime: CliRuntime
): Pick<CliClient, 'listApprovals' | 'getApproval' | 'approveApproval' | 'rejectApproval'> {
  const { policyRoutes } = runtime

  return {
    listApprovals: async () => {
      const result = await policyRoutes.getJson<ApprovalListResponse>('/api/v0/policy/approvals')
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getApproval: async id => {
      const result = await policyRoutes.getJson<ApprovalDetailResponse>(
        `/api/v0/policy/approvals/${id}`
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    approveApproval: async (id, reason) => {
      const result = await policyRoutes.postJson<ApprovalActionResponse>(
        `/api/v0/policy/approvals/${id}/approve`,
        { body: reason ? { reason } : {} }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    rejectApproval: async (id, reason) => {
      const result = await policyRoutes.postJson<ApprovalActionResponse>(
        `/api/v0/policy/approvals/${id}/reject`,
        { body: reason ? { reason } : {} }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}
