import type { PolicyApproval, PolicyApprovalVote } from '../../../../packages/contracts/src/index.ts'
import type { ApprovalStore } from './ports.ts'

/**
 * 内存审批存储，用于单元测试和依赖缺失时的降级路径。
 */
export function createInMemoryApprovalStore(initialApprovals: PolicyApproval[] = []): ApprovalStore {
  const approvals = [...initialApprovals]
  const votes: PolicyApprovalVote[] = []

  return {
    async listApprovals(status) {
      return status ? approvals.filter((approval) => approval.status === status) : [...approvals]
    },
    async getApproval(id) {
      return approvals.find((approval) => approval.id === id) ?? null
    },
    async getVotes(approvalId) {
      return votes.filter((vote) => vote.approvalId === approvalId)
    },
    async createApproval(input) {
      const now = new Date().toISOString()
      const approval: PolicyApproval = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        originService: input.originService,
        operationId: input.operationId,
        requestedBy: input.requestedBy,
        requiredAction: input.requiredAction,
        status: 'pending',
        quorumRequired: input.requiredAction === 'multi_approval' ? 2 : 1,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now
      }
      approvals.push(approval)
      return approval
    },
    async addVote(approvalId, actor, vote, reason) {
      const existing = votes.find((entry) => entry.approvalId === approvalId && entry.actor === actor)
      if (existing) throw new Error('duplicate vote')
      const entry: PolicyApprovalVote = {
        id: crypto.randomUUID(),
        approvalId,
        actor,
        vote,
        ...(reason ? { reason } : {}),
        createdAt: new Date().toISOString()
      }
      votes.push(entry)
      return entry
    },
    async updateApprovalStatus(id, status, completedAt) {
      const approval = approvals.find((candidate) => candidate.id === id)
      if (!approval) return null
      approval.status = status
      approval.updatedAt = new Date().toISOString()
      if (completedAt) approval.completedAt = completedAt
      return approval
    }
  }
}

/**
 * 创建一个测试用的 pending approval，方便测试直接使用。
 */
export function createTestApproval(overrides: Partial<PolicyApproval> = {}): PolicyApproval {
  return {
    id: crypto.randomUUID(),
    policyDecisionId: crypto.randomUUID(),
    originService: 'm-task',
    operationId: crypto.randomUUID(),
    requestedBy: 'operator',
    requiredAction: 'manual_review',
    status: 'pending',
    quorumRequired: 1,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}
