import type {
  ApprovalStatus,
  PolicyApproval,
  PolicyApprovalVote
} from '../../../packages/contracts/src/index.ts'

/**
 * evaluateQuorum 根据当前投票状态判断审批是否达到 quorum。
 * manual_review 只需一票 approve；multi_approval 需要满足 quorumRequired。
 * 任何一票 reject 立即拒绝。
 */
export function evaluateQuorum(
  approval: PolicyApproval,
  votes: PolicyApprovalVote[]
): ApprovalStatus | null {
  const rejectVotes = votes.filter(vote => vote.vote === 'reject')
  if (rejectVotes.length > 0) return 'rejected'

  const approveVotes = votes.filter(vote => vote.vote === 'approve')
  if (approveVotes.length >= approval.quorumRequired) return 'approved'

  return null
}
