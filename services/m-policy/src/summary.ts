import type {
  MinimalPolicyDecisionSummaryFromSchema as MinimalPolicyDecisionSummary,
  PolicyApproval,
  PolicyDecision
} from '../../../packages/contracts/src/index.ts'

export type PolicySummaryPayload = {
  generatedAt: string
  decisions: {
    total: number
    allow: number
    deny: number
    requireManualReview: number
    requireMultiApproval: number
    latestCreatedAt?: string
  }
  recentDecisions: MinimalPolicyDecisionSummary[]
  approvals: {
    total: number
    pending: number
    approved: number
    rejected: number
    expired: number
    canceled: number
    latestCreatedAt?: string
    nextExpiryAt?: string
  }
  pendingApprovals: Array<{
    approvalId: string
    policyDecisionId: string
    requestedBy: PolicyApproval['requestedBy']
    requiredAction: PolicyApproval['requiredAction']
    status: 'pending'
    createdAt: string
    expiresAt: string
  }>
}

export function summarizePolicyState(input: {
  decisions: ReadonlyArray<PolicyDecision>
  approvals: ReadonlyArray<PolicyApproval>
}): PolicySummaryPayload {
  const latestDecision = input.decisions.reduce<string | undefined>((latest, decision) => {
    if (!latest) return decision.createdAt
    return decision.createdAt > latest ? decision.createdAt : latest
  }, undefined)
  const latestApproval = input.approvals.reduce<string | undefined>((latest, approval) => {
    if (!latest) return approval.createdAt
    return approval.createdAt > latest ? approval.createdAt : latest
  }, undefined)
  const nextExpiryAt = input.approvals
    .filter(approval => approval.status === 'pending')
    .map(approval => approval.expiresAt)
    .sort()[0]

  return {
    generatedAt: new Date().toISOString(),
    decisions: {
      total: input.decisions.length,
      allow: input.decisions.filter(decision => decision.result === 'allow').length,
      deny: input.decisions.filter(decision => decision.result === 'deny').length,
      requireManualReview: input.decisions.filter(
        decision => decision.result === 'require_manual_review'
      ).length,
      requireMultiApproval: input.decisions.filter(
        decision => decision.result === 'require_multi_approval'
      ).length,
      ...(latestDecision ? { latestCreatedAt: latestDecision } : {})
    },
    recentDecisions: input.decisions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map<MinimalPolicyDecisionSummary>(decision => ({
        id: decision.id,
        actor: decision.actor,
        action: decision.action,
        resource: decision.resource,
        result: decision.result,
        createdAt: decision.createdAt
      })),
    approvals: {
      total: input.approvals.length,
      pending: input.approvals.filter(approval => approval.status === 'pending').length,
      approved: input.approvals.filter(approval => approval.status === 'approved').length,
      rejected: input.approvals.filter(approval => approval.status === 'rejected').length,
      expired: input.approvals.filter(approval => approval.status === 'expired').length,
      canceled: input.approvals.filter(approval => approval.status === 'canceled').length,
      ...(latestApproval ? { latestCreatedAt: latestApproval } : {}),
      ...(nextExpiryAt ? { nextExpiryAt } : {})
    },
    pendingApprovals: input.approvals
      .filter(approval => approval.status === 'pending')
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, 5)
      .map(approval => ({
        approvalId: approval.id,
        policyDecisionId: approval.policyDecisionId,
        requestedBy: approval.requestedBy,
        requiredAction: approval.requiredAction,
        status: 'pending' as const,
        createdAt: approval.createdAt,
        expiresAt: approval.expiresAt
      }))
  }
}
