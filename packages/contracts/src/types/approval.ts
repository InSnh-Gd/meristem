import type { ActorId } from '../literals.ts'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled'

export type ApprovalVote = 'approve' | 'reject'

export type ApprovalOriginService = 'm-task' | 'm-net'

export type ApprovalOriginAction =
  | 'task.submit'
  | 'task.cancel'
  | 'task.retry'
  | 'mnet.profile.enable'

export type PolicyApproval = {
  id: string
  policyDecisionId: string
  originService: ApprovalOriginService
  operationId: string
  requestedBy: ActorId
  requiredAction: 'manual_review' | 'multi_approval'
  status: ApprovalStatus
  quorumRequired: number
  expiresAt: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type PolicyApprovalVote = {
  id: string
  approvalId: string
  actor: ActorId
  vote: ApprovalVote
  reason?: string
  createdAt: string
}

export type SuspendedOperationStatus =
  | 'suspended'
  | 'resumed'
  | 'rejected'
  | 'expired'
  | 'resume_failed'

export type TaskSuspendedOperation = {
  id: string
  policyDecisionId: string
  action: ApprovalOriginAction
  requestedBy: ActorId
  resource: string
  sanitizedPayload: unknown
  correlationId: string
  idempotencyKey: string
  status: SuspendedOperationStatus
  expiresAt: string
  createdAt: string
  resumedAt?: string
  terminalReason?: string
}

export type ApprovalListResponse = {
  approvals: PolicyApproval[]
}

export type ApprovalDetailResponse = PolicyApproval & {
  votes: PolicyApprovalVote[]
}

export type ApprovalActionRequest = {
  reason?: string
}

export type ApprovalActionResponse = {
  approval: PolicyApproval
  votes: PolicyApprovalVote[]
}
