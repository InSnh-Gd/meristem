import type { ActorId, ApprovalStatus, CreateApprovalRequest, Permission, PolicyApproval, PolicyApprovalVote } from '../../../../packages/contracts/src/index.ts'

// 审批端口抽象，M-Policy 实际实现通过 DB adapter 连接 PostgreSQL。
export type ApprovalStore = {
  listApprovals(status?: ApprovalStatus): Promise<PolicyApproval[]>
  getApproval(id: string): Promise<PolicyApproval | null>
  getVotes(approvalId: string): Promise<PolicyApprovalVote[]>
  createApproval(input: CreateApprovalRequest): Promise<PolicyApproval>
  addVote(approvalId: string, actor: ActorId, vote: 'approve' | 'reject', reason?: string): Promise<PolicyApprovalVote>
  updateApprovalStatus(id: string, status: ApprovalStatus, completedAt?: string): Promise<PolicyApproval | null>
}

export type ApprovalDeps = {
  auth: {
    verify(token: string): Promise<{ ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
  }
  permissionsForActor(actor: ActorId): Promise<readonly Permission[]>
  approvals: ApprovalStore
  log: {
    writeTimeline(input: { summary: string; subject?: string; correlationId?: string }): Promise<unknown>
    writeFull(input: { level: string; source: string; message: string; correlationId?: string; payload?: unknown }): Promise<unknown>
    writeAudit(input: { actor: ActorId | 'system'; action: string; resource: string; decisionId?: string; result: string; correlationId?: string }): Promise<unknown>
  }
  events: {
    publish(subject: string, event: unknown): Promise<unknown>
  }
  onApproved?: (approval: PolicyApproval) => Promise<void>
}
