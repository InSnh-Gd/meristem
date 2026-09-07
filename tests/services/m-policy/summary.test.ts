import { describe, expect, it } from 'bun:test'
import type { PolicyApproval, PolicyDecision } from '../../../packages/contracts/src/index.ts'
import { summarizePolicyState } from '../../../services/m-policy/src/summary.ts'

const decision = (
  id: string,
  createdAt: string,
  result: PolicyDecision['result']
): PolicyDecision => ({
  id,
  actor: 'admin',
  action: 'task:submit',
  resource: `task:${id}`,
  result,
  reasons: [],
  createdAt
})

const approval = (
  id: string,
  createdAt: string,
  expiresAt: string,
  status: PolicyApproval['status']
): PolicyApproval => ({
  id,
  policyDecisionId: `decision-${id}`,
  originService: 'm-task',
  operationId: `operation-${id}`,
  requestedBy: 'admin',
  requiredAction: 'manual_review',
  status,
  quorumRequired: 1,
  expiresAt,
  createdAt,
  updatedAt: createdAt
})

describe('summarizePolicyState', () => {
  it('preserves summary counts, latest timestamps, ordering, and five-item limits', () => {
    const result = summarizePolicyState({
      decisions: [
        decision('d-1', '2026-06-18T01:00:00.000Z', 'allow'),
        decision('d-2', '2026-06-18T04:00:00.000Z', 'deny'),
        decision('d-3', '2026-06-18T03:00:00.000Z', 'require_manual_review'),
        decision('d-4', '2026-06-18T02:00:00.000Z', 'require_multi_approval'),
        decision('d-5', '2026-06-18T06:00:00.000Z', 'allow'),
        decision('d-6', '2026-06-18T05:00:00.000Z', 'deny')
      ],
      approvals: [
        approval('a-1', '2026-06-18T01:00:00.000Z', '2026-06-18T09:00:00.000Z', 'pending'),
        approval('a-2', '2026-06-18T04:00:00.000Z', '2026-06-18T08:00:00.000Z', 'approved'),
        approval('a-3', '2026-06-18T03:00:00.000Z', '2026-06-18T07:00:00.000Z', 'rejected'),
        approval('a-4', '2026-06-18T02:00:00.000Z', '2026-06-18T06:00:00.000Z', 'expired'),
        approval('a-5', '2026-06-18T06:00:00.000Z', '2026-06-18T05:00:00.000Z', 'canceled'),
        approval('a-6', '2026-06-18T05:00:00.000Z', '2026-06-18T04:00:00.000Z', 'pending'),
        approval('a-7', '2026-06-18T07:00:00.000Z', '2026-06-18T03:00:00.000Z', 'pending')
      ]
    })

    expect(result).toMatchObject({
      decisions: {
        total: 6,
        allow: 2,
        deny: 2,
        requireManualReview: 1,
        requireMultiApproval: 1,
        latestCreatedAt: '2026-06-18T06:00:00.000Z'
      },
      recentDecisions: [{ id: 'd-5' }, { id: 'd-6' }, { id: 'd-2' }, { id: 'd-3' }, { id: 'd-4' }],
      approvals: {
        total: 7,
        pending: 3,
        approved: 1,
        rejected: 1,
        expired: 1,
        canceled: 1,
        latestCreatedAt: '2026-06-18T07:00:00.000Z',
        nextExpiryAt: '2026-06-18T03:00:00.000Z'
      },
      pendingApprovals: [{ approvalId: 'a-7' }, { approvalId: 'a-6' }, { approvalId: 'a-1' }]
    })
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('omits optional timestamps and returns empty lists for empty input', () => {
    const result = summarizePolicyState({ decisions: [], approvals: [] })

    expect(result).toMatchObject({
      decisions: {
        total: 0,
        allow: 0,
        deny: 0,
        requireManualReview: 0,
        requireMultiApproval: 0
      },
      recentDecisions: [],
      approvals: {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
        canceled: 0
      },
      pendingApprovals: []
    })
    expect('latestCreatedAt' in result.decisions).toBe(false)
    expect('latestCreatedAt' in result.approvals).toBe(false)
    expect('nextExpiryAt' in result.approvals).toBe(false)
  })
})
