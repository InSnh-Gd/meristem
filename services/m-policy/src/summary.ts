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

/** 汇总策略决策和审批状态，保留内部摘要契约的字段与排序语义。 */
export function summarizePolicyState(input: {
  decisions: ReadonlyArray<PolicyDecision>
  approvals: ReadonlyArray<PolicyApproval>
}): PolicySummaryPayload {
  let allow = 0
  let deny = 0
  let requireManualReview = 0
  let requireMultiApproval = 0
  let latestDecision: string | undefined
  const recentDecisions: MinimalPolicyDecisionSummary[] = []

  // 单次遍历同时完成决策计数、最新时间记录和最近决策的排序输入收集。
  for (const decision of input.decisions) {
    switch (decision.result) {
      case 'allow':
        allow += 1
        break
      case 'deny':
        deny += 1
        break
      case 'require_manual_review':
        requireManualReview += 1
        break
      case 'require_multi_approval':
        requireMultiApproval += 1
        break
    }
    if (!latestDecision || decision.createdAt > latestDecision) {
      latestDecision = decision.createdAt
    }
    recentDecisions.push({
      id: decision.id,
      actor: decision.actor,
      action: decision.action,
      resource: decision.resource,
      result: decision.result,
      createdAt: decision.createdAt
    })
  }

  let pending = 0
  let approved = 0
  let rejected = 0
  let expired = 0
  let canceled = 0
  let latestApproval: string | undefined
  let nextExpiryAt: string | undefined
  const pendingApprovals: PolicyApproval[] = []

  // 单次遍历同时完成审批计数、最新时间和待处理审批的排序输入收集。
  for (const approval of input.approvals) {
    switch (approval.status) {
      case 'pending':
        pending += 1
        pendingApprovals.push(approval)
        if (!nextExpiryAt || approval.expiresAt < nextExpiryAt) {
          nextExpiryAt = approval.expiresAt
        }
        break
      case 'approved':
        approved += 1
        break
      case 'rejected':
        rejected += 1
        break
      case 'expired':
        expired += 1
        break
      case 'canceled':
        canceled += 1
        break
    }
    if (!latestApproval || approval.createdAt > latestApproval) {
      latestApproval = approval.createdAt
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    decisions: {
      total: input.decisions.length,
      allow,
      deny,
      requireManualReview,
      requireMultiApproval,
      ...(latestDecision ? { latestCreatedAt: latestDecision } : {})
    },
    recentDecisions: recentDecisions
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5),
    approvals: {
      total: input.approvals.length,
      pending,
      approved,
      rejected,
      expired,
      canceled,
      ...(latestApproval ? { latestCreatedAt: latestApproval } : {}),
      ...(nextExpiryAt ? { nextExpiryAt } : {})
    },
    pendingApprovals: pendingApprovals
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
