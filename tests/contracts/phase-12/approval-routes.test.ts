import { describe, expect, it } from 'bun:test'
import { createApprovalRoutes, createInMemoryApprovalStore, createTestApproval } from '../../../services/m-policy/src/approval/index.ts'
import type { ActorId, PolicyApproval } from '../../../packages/contracts/src/index.ts'
import { createTestApprovalRoutes } from './helpers.ts'

describe('Phase 12 Approval contract', () => {
  it('lists pending approvals', async () => {
    const approval = createTestApproval({ status: 'pending' })
    const { routes } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request('http://localhost/api/v0/policy/approvals', {
      headers: { authorization: 'Bearer test-token' }
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approvals: Array<{ id: string; status: string }> }
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0]?.id).toBe(approval.id)
  })

  it('gets approval detail with votes', async () => {
    const approval = createTestApproval({ status: 'pending' })
    const { routes } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}`, {
      headers: { authorization: 'Bearer test-token' }
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { id: string; votes: unknown[] }
    expect(body.id).toBe(approval.id)
    expect(body.votes).toEqual([])
  })

  it('approves with one valid security-admin vote for manual review', async () => {
    const approval = createTestApproval({ requiredAction: 'manual_review', quorumRequired: 1 })
    let approvedCallback: PolicyApproval | null = null
    const { routes, store, auditLog } = createTestApprovalRoutes({
      approvals: [approval],
      onApproved: async (a) => { approvedCallback = a }
    })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'looks safe' })
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approval: { status: string }; votes: Array<{ vote: string }> }
    expect(body.approval.status).toBe('approved')
    expect(body.votes).toHaveLength(1)
    expect(body.votes[0]?.vote).toBe('approve')
    expect(approvedCallback).not.toBeNull()
    expect(auditLog.some((entry) => entry.action === 'policy.approval.approve')).toBe(true)
  })

  it('approves with two distinct security-admin votes for multi-approval', async () => {
    const approval = createTestApproval({ requiredAction: 'multi_approval', quorumRequired: 2 })
    const store = createInMemoryApprovalStore([approval])
    const auditLog: Array<{ action: string }> = []

    // 第一票
    const routes1 = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      async permissionsForActor() { return ['policy:approval-approve'] },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit(input) { auditLog.push(input) } },
      events: { async publish() {} }
    })

    const resp1 = await routes1.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer token1', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))
    const body1 = await resp1.json() as { approval: { status: string } }
    expect(body1.approval.status).toBe('pending')

    // 非 security-admin 权限不能 approve，即使 actor 名称是 admin。
    const routes2 = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'admin' as ActorId } } },
      async permissionsForActor() { return ['policy:approval-read'] },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit(input) { auditLog.push(input) } },
      events: { async publish() {} }
    })

    const resp2 = await routes2.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer token2', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))
    expect(resp2.status).toBe(403)
    const denied = await resp2.json() as { error: { code: string } }
    expect(denied.error.code).toBe('approval.permission_denied')

    const routes3 = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'admin' as ActorId } } },
      async permissionsForActor() { return ['policy:approval-approve'] },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit(input) { auditLog.push(input) } },
      events: { async publish() {} }
    })

    const resp3 = await routes3.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer token3', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))
    const body3 = await resp3.json() as { approval: { status: string } }
    expect(body3.approval.status).toBe('approved')
  })

  it('rejects self-approval by original actor', async () => {
    const approval = createTestApproval({ requestedBy: 'operator' })
    const { routes, fullLog } = createTestApprovalRoutes({
      actor: 'operator',
      approvals: [approval]
    })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    expect(response.status).toBe(403)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('approval.self_vote_denied')
    expect(fullLog.some((entry) => entry.message === 'self-approval denied')).toBe(true)
  })

  it('rejects duplicate vote from same actor', async () => {
    const approval = createTestApproval({ requestedBy: 'operator', requiredAction: 'multi_approval', quorumRequired: 2 })
    const { routes, fullLog } = createTestApprovalRoutes({ approvals: [approval] })

    // 第一票
    await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    // 重复投票
    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('approval.duplicate_vote')
    expect(fullLog.some((entry) => entry.message === 'duplicate vote attempt')).toBe(true)
  })

  it('one reject vote rejects approval immediately', async () => {
    const approval = createTestApproval({ requiredAction: 'multi_approval', quorumRequired: 2 })
    const { routes, auditLog } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/reject`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'security concern' })
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approval: { status: string } }
    expect(body.approval.status).toBe('rejected')
    expect(auditLog.some((entry) => entry.action === 'policy.approval.reject')).toBe(true)
  })

  it('expired approval returns 409', async () => {
    const approval = createTestApproval({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const { routes } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('approval.expired')
  })

  it('non-pending approval returns 409', async () => {
    const approval = createTestApproval({ status: 'approved' })
    const { routes } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('approval.not_pending')
  })
})
