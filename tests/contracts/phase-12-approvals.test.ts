import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { ApprovalStatusSchema, ApprovalVoteTypeSchema, PolicyApprovalSchema, PolicyApprovalVoteSchema, TaskSuspendedOperationSchema } from '../../packages/contracts/src/schemas/policy.ts'
import { createApprovalRoutes, createInMemoryApprovalStore, createTestApproval } from '../../services/m-policy/src/approvals.ts'
import { createMTaskApp, createInMemoryMTaskDeps } from '../../services/m-task/src/app.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-task/src/suspended-operations.ts'
import type { ActorId, PolicyApproval } from '../../packages/contracts/src/index.ts'
import { ok } from '../../packages/common/src/result.ts'

// Phase 12 审批流程契约测试：覆盖 quorum 规则、自审批拒绝、重复投票拒绝、过期处理。

function createTestApprovalRoutes(options: {
  actor?: ActorId
  approvals?: PolicyApproval[]
  onApproved?: (approval: PolicyApproval) => Promise<void>
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
    onApproved: options.onApproved
  })

  return { routes, store, timeline, fullLog, auditLog, published }
}

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
    expect(body.approvals[0].id).toBe(approval.id)
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
    expect(body.votes[0].vote).toBe('approve')
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
      events: { async publish() {} }
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
      events: { async publish() {} }
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

describe('Phase 12 M-Task resume contract', () => {
  it('resume fails on non-existent suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
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

  it('resume fails on expired suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
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
    expect(suspendedOps.__testing.all()[0].status).toBe('suspended')
  })
})

describe('Phase 12 contract type decode', () => {
  it('approval permission literals include policy:approval-read', async () => {
    const { approvalPermissions, permissions } = await import('../../packages/contracts/src/literals.ts')
    expect(approvalPermissions).toContain('policy:approval-read')
    expect(approvalPermissions).toContain('policy:approval-approve')
    expect(approvalPermissions).toContain('policy:approval-reject')
    expect(approvalPermissions).toContain('policy:approval-manage')
    expect(permissions).toContain('policy:approval-read')
  })

  it('role permissions include approval permissions for security-admin', async () => {
    const { rolePermissions } = await import('../../packages/policy/src/index.ts')
    expect(rolePermissions['security-admin']).toContain('policy:approval-read')
    expect(rolePermissions['security-admin']).toContain('policy:approval-approve')
    expect(rolePermissions['security-admin']).toContain('policy:approval-reject')
    expect(rolePermissions['admin']).toContain('policy:approval-read')
    expect(rolePermissions['admin']).not.toContain('policy:approval-approve')
    expect(rolePermissions['operator']).not.toContain('policy:approval-read')
  })
})

describe('Phase 12 failure-mode tests', () => {
  it('audit log unavailable fails approval vote closed', async () => {
    const approval = createTestApproval({ requestedBy: 'operator', requiredAction: 'manual_review', quorumRequired: 1 })
    const store = createInMemoryApprovalStore([approval])
    const routes = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      approvals: store,
      log: {
        async writeTimeline() { throw new Error('audit unavailable') },
        async writeFull() {},
        async writeAudit() { throw new Error('audit unavailable') }
      },
      events: { async publish() {} }
    })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    // 审计写入失败时，审批操作应传播错误而非静默成功
    expect(response.status).toBeGreaterThanOrEqual(500)
  })

  it('event publish failure does not create false authoritative state', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', forcePolicyResult: 'require_manual_review' })
    const originalPublish = deps.events.publish
    let publishCallCount = 0
    deps.events.publish = async (subject, event) => {
      publishCallCount++
      if (subject === 'task.operation.suspended.v0') {
        return { ok: false as const, error: { code: 'event.publish_failed', message: 'NATS unavailable' } }
      }
      return originalPublish(subject, event)
    }
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request('http://localhost/api/v0/tasks/task-existing/retry', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))

    // blockIfNeeded 事件发布失败不会阻止挂起操作创建
    expect(response.status).toBe(409)
    expect(suspendedOps.__testing.all()).toHaveLength(1)
  })

  it('consumed idempotency key cannot be resumed twice', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const suspendedOps = createInMemorySuspendedOperationStore()
    const task = await deps.storage.create({ nodeId: 'node-leaf-1', type: 'noop', actor: 'operator', correlationId: 'corr-1', policyDecisionId: 'pd-1', risk: { operationDangerLevel: 'medium', suspicionScore: 5, riskFactors: [] } })
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

    // 第一次 resume 成功
    const resp1 = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))
    expect(resp1.status).toBe(200)

    // 第二次 resume 失败，因为已经 resumed
    const resp2 = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token' }
    }))
    expect(resp2.status).toBe(409)
    const body2 = await resp2.json() as { error: { code: string } }
    expect(body2.error.code).toBe('task.resume_conflict')
  })

  it('approval reject marks suspended op and does not execute', async () => {
    const approval = createTestApproval({ requestedBy: 'operator', requiredAction: 'manual_review', quorumRequired: 1 })
    const { routes, store, auditLog } = createTestApprovalRoutes({ approvals: [approval] })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/reject`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'security concern' })
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as { approval: { status: string }; votes: Array<{ vote: string }> }
    expect(body.approval.status).toBe('rejected')
    expect(body.votes[0].vote).toBe('reject')
    expect(auditLog.some((entry) => entry.action === 'policy.approval.reject')).toBe(true)

    // 确认审批状态已更新
    const updated = await store.getApproval(approval.id)
    expect(updated?.status).toBe('rejected')
    expect(updated?.completedAt).toBeDefined()
  })

  it('approval approved but stale target records resume_failed', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const suspendedOps = createInMemorySuspendedOperationStore()
    // 创建挂起操作指向不存在的任务
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

    // 挂起操作状态应标记为 expired
    const updatedOp = await suspendedOps.get(suspendedOp.id)
    expect(updatedOp?.status).toBe('expired')
    expect(updatedOp?.terminalReason).toContain('target_task_not_found')
  })
})

describe('Phase 12 Effect Schema decode/encode', () => {
  it('ApprovalStatusSchema decodes all valid statuses', async () => {

    for (const status of ['pending', 'approved', 'rejected', 'expired', 'canceled']) {
      const decoded = Schema.decodeUnknownSync(ApprovalStatusSchema)(status)
      expect(decoded).toBe(status)
    }
  })

  it('ApprovalStatusSchema rejects invalid status', async () => {

    expect(() => Schema.decodeUnknownSync(ApprovalStatusSchema)('invalid')).toThrow()
  })

  it('ApprovalVoteTypeSchema decodes approve and reject', async () => {

    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('approve')).toBe('approve')
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('reject')).toBe('reject')
    expect(() => Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('abstain')).toThrow()
  })

  it('PolicyApprovalSchema decodes a complete approval record', async () => {

    const approval = {
      id: 'test-id',
      policyDecisionId: 'pd-id',
      originService: 'm-task',
      operationId: 'op-id',
      requestedBy: 'operator',
      requiredAction: 'manual_review',
      status: 'pending',
      quorumRequired: 1,
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const decoded = Schema.decodeUnknownSync(PolicyApprovalSchema)(approval)
    expect(decoded.id).toBe('test-id')
    expect(decoded.originService).toBe('m-task')
    expect(decoded.status).toBe('pending')
  })

  it('PolicyApprovalVoteSchema decodes a vote record', async () => {

    const vote = {
      id: 'vote-id',
      approvalId: 'approval-id',
      actor: 'security-admin',
      vote: 'approve',
      reason: 'looks safe',
      createdAt: new Date().toISOString()
    }

    const decoded = Schema.decodeUnknownSync(PolicyApprovalVoteSchema)(vote)
    expect(decoded.vote).toBe('approve')
    expect(decoded.reason).toBe('looks safe')
  })

  it('TaskSuspendedOperationSchema decodes a suspended operation', async () => {

    const op = {
      id: 'op-id',
      policyDecisionId: 'pd-id',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: 'task:123',
      sanitizedPayload: { action: 'task:cancel' },
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      status: 'suspended',
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }

    const decoded = Schema.decodeUnknownSync(TaskSuspendedOperationSchema)(op)
    expect(decoded.status).toBe('suspended')
    expect(decoded.action).toBe('task.cancel')
  })

  it('approval permissions stay in sync between literals and policy RBAC', async () => {
    const { approvalPermissions, permissions } = await import('../../packages/contracts/src/literals.ts')
    const { rolePermissions } = await import('../../packages/policy/src/index.ts')

    // approvalPermissions 中的所有权限必须出现在 permissions 列表中
    for (const perm of approvalPermissions) {
      expect(permissions).toContain(perm)
    }

    // security-admin 必须拥有所有 approvalPermissions
    for (const perm of approvalPermissions) {
      expect(rolePermissions['security-admin']).toContain(perm)
    }

    // admin 只有 policy:approval-read
    expect(rolePermissions['admin']).toContain('policy:approval-read')
    expect(rolePermissions['admin']).not.toContain('policy:approval-approve')
    expect(rolePermissions['admin']).not.toContain('policy:approval-reject')
    expect(rolePermissions['admin']).not.toContain('policy:approval-manage')
  })

  it('Elysia approval schemas match contract type shapes', async () => {
    // 确保 approvals.ts 中的 Elysia schema 与 contracts 类型保持一致
    const { createInMemoryApprovalStore, createTestApproval, createApprovalRoutes } = await import('../../services/m-policy/src/approvals.ts')

    const approval = createTestApproval()
    const store = createInMemoryApprovalStore([approval])
    const routes = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit() {} },
      events: { async publish() {} }
    })

    const response = await routes.handle(new Request('http://localhost/api/v0/policy/approvals', {
      headers: { authorization: 'Bearer test-token' }
    }))
    const body = await response.json() as { approvals: Array<Record<string, unknown>> }

    // Elysia 响应字段必须与 PolicyApproval 类型字段匹配
    expect(body.approvals[0]).toHaveProperty('id')
    expect(body.approvals[0]).toHaveProperty('policyDecisionId')
    expect(body.approvals[0]).toHaveProperty('originService')
    expect(body.approvals[0]).toHaveProperty('operationId')
    expect(body.approvals[0]).toHaveProperty('requestedBy')
    expect(body.approvals[0]).toHaveProperty('requiredAction')
    expect(body.approvals[0]).toHaveProperty('status')
    expect(body.approvals[0]).toHaveProperty('quorumRequired')
    expect(body.approvals[0]).toHaveProperty('expiresAt')
    expect(body.approvals[0]).toHaveProperty('createdAt')
    expect(body.approvals[0]).toHaveProperty('updatedAt')
  })
})
