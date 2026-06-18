import { afterEach, describe, expect, it } from 'bun:test'
import { createPolicyApp } from '../../../services/m-policy/src/app.ts'

const originalToken = process.env.MERISTEM_INTERNAL_TOKEN

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.MERISTEM_INTERNAL_TOKEN
  } else {
    process.env.MERISTEM_INTERNAL_TOKEN = originalToken
  }
})

describe('m-policy app', () => {
  it('returns internal summary for authorized callers', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    const app = createPolicyApp({
      readiness: async () => ({ ready: true }),
      authorize: async () => ({
        id: 'decision-1',
        actor: 'admin',
        action: 'task:submit',
        resource: 'task:123',
        result: 'allow',
        reasons: [],
        createdAt: '2026-06-18T00:00:00.000Z'
      }),
      getDecision: async () => null,
      getSummary: async () => ({
        generatedAt: '2026-06-18T00:00:00.000Z',
        decisions: {
          total: 2,
          allow: 1,
          deny: 0,
          requireManualReview: 0,
          requireMultiApproval: 1,
          latestCreatedAt: '2026-06-18T00:00:00.000Z'
        },
        recentDecisions: [
          {
            id: 'decision-1',
            actor: 'admin',
            action: 'task:submit',
            resource: 'task:123',
            result: 'allow',
            createdAt: '2026-06-18T00:00:00.000Z'
          }
        ],
        approvals: {
          total: 1,
          pending: 1,
          approved: 0,
          rejected: 0,
          expired: 0,
          canceled: 0,
          latestCreatedAt: '2026-06-18T00:00:00.000Z',
          nextExpiryAt: '2026-06-18T01:00:00.000Z'
        },
        pendingApprovals: [
          {
            approvalId: 'approval-1',
            policyDecisionId: 'decision-1',
            requestedBy: 'admin',
            requiredAction: 'multi_approval',
            status: 'pending',
            createdAt: '2026-06-18T00:00:00.000Z',
            expiresAt: '2026-06-18T01:00:00.000Z'
          }
        ]
      })
    })

    const response = await app.handle(
      new Request('http://localhost/internal/v0/summary', {
        method: 'GET',
        headers: { 'x-meristem-internal-token': 'shared-token' }
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      decisions: { total: 2 },
      approvals: { pending: 1 }
    })
  })

  it('rejects internal summary without internal token', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    const app = createPolicyApp({
      readiness: async () => ({ ready: true }),
      authorize: async () => ({
        id: 'decision-1',
        actor: 'admin',
        action: 'task:submit',
        resource: 'task:123',
        result: 'allow',
        reasons: [],
        createdAt: '2026-06-18T00:00:00.000Z'
      }),
      getDecision: async () => null,
      getSummary: async () => ({
        generatedAt: '2026-06-18T00:00:00.000Z',
        decisions: { total: 0, allow: 0, deny: 0, requireManualReview: 0, requireMultiApproval: 0 },
        recentDecisions: [],
        approvals: { total: 0, pending: 0, approved: 0, rejected: 0, expired: 0, canceled: 0 },
        pendingApprovals: []
      })
    })

    const response = await app.handle(new Request('http://localhost/internal/v0/summary'))

    expect(response.status).toBe(401)
  })
})
