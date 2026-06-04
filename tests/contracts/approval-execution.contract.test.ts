import { describe, expect, it } from 'bun:test'
import { createApprovalRoutes, createInMemoryApprovalStore, createInternalApprovalRoutes, createTestApproval } from '../../services/m-policy/src/approvals.ts'
import { createMTaskApp } from '../../services/m-task/src/app.ts'
import { createInMemoryMTaskDeps } from '../../services/m-task/src/testing.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-task/src/suspended-operations.ts'
import type { ActorId, PolicyApproval } from '../../packages/contracts/src/index.ts'

// 审批流程契约测试：覆盖 quorum 规则、自审批拒绝、重复投票拒绝、过期处理。

function createTestApprovalRoutes(options: {
  actor?: ActorId
  approvals?: PolicyApproval[]
  onApproved?: (approval: PolicyApproval) => Promise<void>
  onRejected?: (approval: PolicyApproval) => Promise<void>
} = {}) {
  const actor = options.actor ?? 'security-admin'
  const store = createInMemoryApprovalStore(options.approvals ?? [])
  const timeline: Array<{ summary: string }> = []
  const fullLog: Array<{ message: string }> = []
  const auditLog: Array<{ action: string }> = []
  const published: Array<{ subject: string }> = []

  const routes = createApprovalRoutes({
    auth: {
      async verify() {
        return { ok: true as const, actor }
      }
    },
    approvals: store,
    log: {
      async writeTimeline(input) { timeline.push(input) },
      async writeFull(input) { fullLog.push(input) },
      async writeAudit(input) { auditLog.push(input) }
    },
    events: {
      async publish(subject) { published.push({ subject }) }
    },
    async authorize() { return true },
    ...(options.onApproved ? { onApproved: options.onApproved } : {}),
    ...(options.onRejected ? { onRejected: options.onRejected } : {})
  })

  return { routes, store, timeline, fullLog, auditLog, published }
}

describe('Approval execution contract', () => {
  it('lists pending approvals', async () => {
    const approval = createTestApproval({ status: 'pending' })
    const { routes } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request('http://localhost/api/v0/policy/approvals', {
      headers: { authorization: 'Bearer test-token' }
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approvals: Array<{ id: string; status: string }> }
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0]!.id).toBe(approval.id)
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
    const { routes, auditLog } = createTestApprovalRoutes({
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
    expect(body.votes[0]!.vote).toBe('approve')
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
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit(input) { auditLog.push(input) } },
      events: { async publish() {} },
      async authorize() { return true }
    })

    const resp1 = await routes1.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer token1', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))
    const body1 = await resp1.json() as { approval: { status: string } }
    expect(body1.approval.status).toBe('pending')

    // 第二票
    const routes2 = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'admin' as ActorId } } },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit(input) { auditLog.push(input) } },
      events: { async publish() {} },
      async authorize() { return true }
    })

    const resp2 = await routes2.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer token2', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))
    const body2 = await resp2.json() as { approval: { status: string } }
    expect(body2.approval.status).toBe('approved')
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

describe('M-Task resume contract', () => {
  it('resume fails on non-existent suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request('http://localhost/internal/v0/task-operations/nonexistent/resume', {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))

    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.suspended_op_not_found')
  })

  it('resume succeeds on valid suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    // 先创建一个任务
    const task = await deps.storage.create({ nodeId: 'node-leaf-1', type: 'noop', actor: 'operator', correlationId: 'corr-1', policyDecisionId: 'pd-1', risk: { operationDangerLevel: 'medium', suspicionScore: 5, riskFactors: [] } })
    // 创建挂起操作
    const suspendedOp = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: `task:${task.id}`,
      sanitizedPayload: {},
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    })

    const app = createMTaskApp({ ...deps, suspendedOps })
    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { resumed: boolean; suspendedOpId: string }
    expect(body.resumed).toBe(true)
    expect(body.suspendedOpId).toBe(suspendedOp.id)
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.resumed.v0')
    expect(deps.__testing.auditActions()).toContain('task.operation.resume')
  })

  it('resume creates task for blocked task.submit approval', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    // task.submit 被策略阻塞时任务尚未创建，resource 是 node:xxx
    const suspendedOp = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'task.submit',
      requestedBy: 'operator',
      resource: 'node:node-leaf-1',
      sanitizedPayload: { action: 'task:submit', resource: 'node:node-leaf-1', risk: { operationDangerLevel: 'medium' as const, suspicionScore: 5, riskFactors: [] } },
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    })

    // 确保任务尚不存在
    expect(await deps.storage.get('node-leaf-1')).toBeNull()

    const app = createMTaskApp({ ...deps, suspendedOps })
    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { resumed: boolean; suspendedOpId: string; task: { id: string; nodeId: string; type: string } | null }
    expect(body.resumed).toBe(true)
    expect(body.task).not.toBeNull()
    expect(body.task!.nodeId).toBe('node-leaf-1')
    expect(body.task!.type).toBe('noop')
    expect((await suspendedOps.get(suspendedOp.id))?.status).toBe('resumed')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.resumed.v0')
  })

  it('resume fails on expired suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const suspendedOp = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: 'task:nonexistent',
      sanitizedPayload: {},
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      expiresAt: new Date(Date.now() - 1000).toISOString()
    })

    const app = createMTaskApp({ ...deps, suspendedOps })
    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.resume_expired')
  })

  it('resume fails on stale target task', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const suspendedOp = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: 'task:nonexistent-task-id',
      sanitizedPayload: {},
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    })

    const app = createMTaskApp({ ...deps, suspendedOps })
    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.resume_stale')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.resume.failure.v0')
  })

  it('resume creates suspended operation when policy blocks', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', forcePolicyResult: 'require_manual_review' })
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request('http://localhost/api/v0/tasks/task-existing/retry', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { policyDecision: { result: string } }
    expect(body.policyDecision.result).toBe('require_manual_review')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.suspended.v0')
    expect(suspendedOps.__testing.all()).toHaveLength(1)
    expect(suspendedOps.__testing.all()[0]!.status).toBe('suspended')
  })
})

describe('Internal approval and reject', () => {
  it('onRejected callback fires when approval is rejected', async () => {
    const approval = createTestApproval({ requiredAction: 'manual_review', quorumRequired: 1 })
    let rejectedCallback: PolicyApproval | null = null
    const { routes, auditLog } = createTestApprovalRoutes({
      approvals: [approval],
      onRejected: async (a) => { rejectedCallback = a }
    })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/reject`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'not safe' })
    }))

    expect(response.status).toBe(200)
    expect(rejectedCallback).not.toBeNull()
    expect(rejectedCallback!.id).toBe(approval.id)
    expect(rejectedCallback!.status).toBe('rejected')
    expect(auditLog.some((entry) => entry.action === 'policy.approval.reject')).toBe(true)
  })

  it('internal approval creation route accepts valid internal token', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const routes = createInternalApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      approvals: createInMemoryApprovalStore([]),
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit() {} },
      events: { async publish() {} },
      async authorize() { return true }
    })

    const response = await routes.handle(new Request('http://localhost/internal/v0/policy/approvals', {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        policyDecisionId: 'pd-1',
        originService: 'm-task',
        operationId: 'op-1',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        quorumRequired: 1,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      })
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approval: { id: string; status: string; originService: string } }
    expect(body.approval.status).toBe('pending')
    expect(body.approval.originService).toBe('m-task')
  })

  it('internal approval creation route rejects missing internal token', async () => {
    const routes = createInternalApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      approvals: createInMemoryApprovalStore([]),
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit() {} },
      events: { async publish() {} },
      async authorize() { return true }
    })

    const response = await routes.handle(new Request('http://localhost/internal/v0/policy/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        policyDecisionId: 'pd-1',
        originService: 'm-task',
        operationId: 'op-1',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        quorumRequired: 1,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      })
    }))

    expect(response.status).toBe(401)
  })
})
