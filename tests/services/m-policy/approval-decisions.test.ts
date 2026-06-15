import { describe, expect, it } from 'bun:test'
import type { PolicyApprovalVote } from '../../../packages/contracts/src/index.ts'
import { evaluateQuorum } from '../../../services/m-policy/src/approval-decisions.ts'
import { createTestApproval } from '../../../services/m-policy/src/approval-helpers.ts'

const createVote = (overrides: Partial<PolicyApprovalVote>): PolicyApprovalVote => ({
  id: 'vote-1',
  approvalId: 'approval-1',
  actor: 'operator',
  vote: 'approve',
  createdAt: '2026-06-15T12:00:00.000Z',
  ...overrides
})

describe('approval decisions', () => {
  it('approves when approve votes meet the required quorum', () => {
    const approval = createTestApproval({ quorumRequired: 2 })

    expect(
      evaluateQuorum(approval, [
        createVote({ id: 'vote-1', actor: 'operator', vote: 'approve' }),
        createVote({ id: 'vote-2', actor: 'admin', vote: 'approve' })
      ])
    ).toBe('approved')
  })

  it('rejects immediately when any reject vote is present', () => {
    const approval = createTestApproval({ quorumRequired: 2 })

    expect(
      evaluateQuorum(approval, [
        createVote({ id: 'vote-1', actor: 'operator', vote: 'approve' }),
        createVote({ id: 'vote-2', actor: 'admin', vote: 'reject' })
      ])
    ).toBe('rejected')
  })

  it('returns null while quorum is not reached', () => {
    const approval = createTestApproval({ quorumRequired: 2 })

    expect(
      evaluateQuorum(approval, [createVote({ id: 'vote-1', actor: 'operator', vote: 'approve' })])
    ).toBeNull()
  })
})
