import { describe, expect, it } from 'bun:test'
import { createApprovalRoutes, createInMemoryApprovalStore, createTestApproval } from '../../services/m-policy/src/approvals.ts'
import { createMTaskApp } from '../../services/m-task/src/app.ts'
import { createInMemoryMTaskDeps } from '../../services/m-task/src/testing.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-task/src/suspended-operations.ts'
import type { ActorId } from '../../packages/contracts/src/index.ts'

describe('Phase 12 approval failure modes', () => {
  it('audit log unavailable fails approval vote closed', async () => {
    const approval = createTestApproval({ requestedBy: 'operator', requiredAction: 'manual_review', quorumRequired: 1 })
    const routes = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      approvals: createInMemoryApprovalStore([approval]),
      log: { async writeTimeline() { throw new Error('audit unavailable') }, async writeFull() {}, async writeAudit() { throw new Error('audit unavailable') } },
      events: { async publish() {} },
      async authorize() { return true }
    })

    const response = await routes.handle(new Request(`http://localhost/api/v0/policy/approvals/${approval.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))

    expect(response.status).toBeGreaterThanOrEqual(500)
  })

  it('event publish failure does not create false authoritative state', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', forcePolicyResult: 'require_manual_review' })
    const originalPublish = deps.events.publish
    deps.events.publish = async (subject, event) => subject === 'task.operation.suspended.v0'
      ? { ok: false as const, error: { code: 'event.publish_failed', message: 'NATS unavailable' } }
      : originalPublish(subject, event)
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request('http://localhost/api/v0/tasks/task-existing/retry', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))

    expect(response.status).toBe(409)
    expect(suspendedOps.__testing.all()).toHaveLength(1)
  })

  it('consumed idempotency key cannot be resumed twice', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const task = await deps.storage.create({ nodeId: 'node-leaf-1', type: 'noop', actor: 'operator', correlationId: 'corr-1', policyDecisionId: 'pd-1', risk: { operationDangerLevel: 'medium', suspicionScore: 5, riskFactors: [] } })
    const suspendedOp = await suspendedOps.create({ policyDecisionId: 'pd-1', action: 'task.cancel', requestedBy: 'operator', resource: `task:${task.id}`, sanitizedPayload: {}, correlationId: 'corr-1', idempotencyKey: 'key-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    const app = createMTaskApp({ ...deps, suspendedOps })

    const first = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, { method: 'POST', headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN } }))
    const second = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, { method: 'POST', headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN } }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    const body = await second.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.resume_conflict')
  })

  it('approval approved but stale target records resume_failed', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const suspendedOp = await suspendedOps.create({ policyDecisionId: 'pd-1', action: 'task.cancel', requestedBy: 'operator', resource: 'task:missing', sanitizedPayload: {}, correlationId: 'corr-1', idempotencyKey: 'key-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/resume`, { method: 'POST', headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN } }))

    expect(response.status).toBe(409)
    expect((await suspendedOps.get(suspendedOp.id))?.status).toBe('resume_failed')
  })

  it('M-Task reject endpoint transitions suspended op to rejected', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const task = await deps.storage.create({ nodeId: 'node-leaf-1', type: 'noop', actor: 'operator', correlationId: 'corr-1', policyDecisionId: 'pd-1', risk: { operationDangerLevel: 'medium', suspicionScore: 5, riskFactors: [] } })
    const suspendedOp = await suspendedOps.create({ policyDecisionId: 'pd-1', action: 'task.cancel', requestedBy: 'operator', resource: `task:${task.id}`, sanitizedPayload: {}, correlationId: 'corr-1', idempotencyKey: 'key-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/reject`, { method: 'POST', headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN } }))

    expect(response.status).toBe(200)
    const body = await response.json() as { rejected: boolean; suspendedOpId: string }
    expect(body.rejected).toBe(true)
    expect(body.suspendedOpId).toBe(suspendedOp.id)
    expect((await suspendedOps.get(suspendedOp.id))?.status).toBe('rejected')
    expect(deps.__testing.auditActions()).toContain('task.operation.reject')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.rejected.v0')
  })

  it('M-Task reject endpoint rejects non-suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    const suspendedOps = createInMemorySuspendedOperationStore()
    const task = await deps.storage.create({ nodeId: 'node-leaf-1', type: 'noop', actor: 'operator', correlationId: 'corr-1', policyDecisionId: 'pd-1', risk: { operationDangerLevel: 'medium', suspicionScore: 5, riskFactors: [] } })
    const suspendedOp = await suspendedOps.create({ policyDecisionId: 'pd-1', action: 'task.cancel', requestedBy: 'operator', resource: `task:${task.id}`, sanitizedPayload: {}, correlationId: 'corr-1', idempotencyKey: 'key-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    await suspendedOps.transition(suspendedOp.id, 'rejected', 'already done')
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${suspendedOp.id}/reject`, { method: 'POST', headers: { 'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN } }))

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('task.reject_conflict')
  })

  it('M-Task reject endpoint rejects missing internal token', async () => {
    const app = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

    const response = await app.handle(new Request('http://localhost/internal/v0/task-operations/fake-id/reject', { method: 'POST', headers: {} }))

    expect(response.status).toBe(401)
  })
})
