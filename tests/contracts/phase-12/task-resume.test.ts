import { describe, expect, it } from 'bun:test'
import { createMTaskApp } from '../../../services/m-task/src/app.ts'
import { createInMemoryMTaskDeps } from '../../../services/m-task/src/testing.ts'
import { createInMemorySuspendedOperationStore } from '../../../services/m-task/src/suspended-operation/index.ts'
import { internalToken, resumeBody } from './helpers.ts'

describe('Phase 12 M-Task resume contract', () => {
  it('resume fails on non-existent suspended operation', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const response = await app.handle(new Request('http://localhost/internal/v0/task-operations/nonexistent/resume', {
      method: 'POST',
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: 'pd-1' })
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
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
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
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
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
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: suspendedOp.policyDecisionId })
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
    expect(suspendedOps.__testing.all()[0]?.status).toBe('suspended')
  })

  it('resume executes blocked task submit from suspended payload', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', forcePolicyResult: 'require_manual_review' })
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createMTaskApp({ ...deps, suspendedOps })

    const blocked = await app.handle(new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token', 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-leaf-1', type: 'noop' })
    }))

    expect(blocked.status).toBe(409)
    const blockedBody = await blocked.json() as { policyDecision: { decisionId: string }; operationId: string }
    const suspendedOp = suspendedOps.__testing.all().find((op) => op.id === blockedBody.operationId)
    expect(suspendedOp?.action).toBe('task.submit')

    const resumed = await app.handle(new Request(`http://localhost/internal/v0/task-operations/${blockedBody.operationId}/resume`, {
      method: 'POST',
      headers: { 'x-meristem-internal-token': internalToken, 'content-type': 'application/json' },
      body: resumeBody({ policyDecisionId: blockedBody.policyDecision.decisionId })
    }))

    expect(resumed.status).toBe(200)
    const resumedBody = await resumed.json() as { resumed: boolean; task: { status: string; nodeId: string } | null }
    expect(resumedBody.resumed).toBe(true)
    expect(resumedBody.task?.status).toBe('completed')
    expect(resumedBody.task?.nodeId).toBe('node-leaf-1')
    expect(deps.__testing.publishedSubjects()).toContain('task.completed.v0')
    expect(deps.__testing.publishedSubjects()).toContain('task.operation.resumed.v0')
  })
})
