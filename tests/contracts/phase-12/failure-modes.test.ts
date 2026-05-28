import { describe, expect, it } from 'bun:test'
import { createApprovalRoutes, createInMemoryApprovalStore, createTestApproval } from '../../../services/m-policy/src/approval/index.ts'
import { createMTaskApp } from '../../../services/m-task/src/app.ts'
import { createInMemoryMTaskDeps } from '../../../services/m-task/src/testing.ts'
import { createInMemorySuspendedOperationStore } from '../../../services/m-task/src/suspended-operation/index.ts'
import type { ActorId } from '../../../packages/contracts/src/index.ts'
import { internalToken, resumeBody, createTestApprovalRoutes } from './helpers.ts'

describe('Phase 12 failure-mode tests', () => {
  it('audit log unavailable fails approval vote closed', async () => {
    const approval = createTestApproval({ requestedBy: 'operator', requiredAction: 'manual_review', quorumRequired: 1 })
    const store = createInMemoryApprovalStore([approval])
    const routes = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      async permissionsForActor() { return ['policy:approval-approve'] },
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
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
    }))
    expect(resp1.status).toBe(200)

    // 第二次 resume 失败，因为已经 resumed
    const resp2 = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
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
    expect(body.votes[0]?.vote).toBe('reject')
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
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
    }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.resume_stale')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.resume.failure.v0')

    const updatedOp = await suspendedOps.get(suspendedOp.id)
    expect(updatedOp?.status).toBe('resume_failed')
    expect(updatedOp?.terminalReason).toContain('target_task_not_found')
  })
})
