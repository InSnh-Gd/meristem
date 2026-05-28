import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import { createMTaskApp } from '../../services/m-task/src/app.ts'
import { createInMemoryMTaskDeps } from '../../services/m-task/src/testing.ts'

describe('M-Task Phase 11 service cutover', () => {
  it('removes Core as the canonical task REST owner', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))

    const openapi = await app.handle(new Request('http://localhost/openapi/json'))
    const body = await openapi.json() as { paths: Record<string, unknown> }

    expect(body.paths['/api/v0/tasks']).toBeUndefined()
    expect(body.paths['/api/v0/tasks/{id}']).toBeUndefined()

    const response = await app.handle(new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ leafNodeId: 'node-leaf-1', type: 'noop' })
    }))
    expect(response.status).toBe(404)
  })

  it('submits noop tasks through M-Task and publishes task-owned lifecycle events', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const app = createMTaskApp(deps)

    const response = await app.handle(new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-task-submit'
      },
      body: JSON.stringify({ nodeId: 'node-leaf-1', type: 'noop' })
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as {
      task: { id: string; nodeId: string; status: string; type: string }
      policyDecisionId: string
      risk: { operationDangerLevel: string; suspicionScore: number; riskFactors: string[] }
    }
    expect(body.task.nodeId).toBe('node-leaf-1')
    expect(body.task.status).toBe('completed')
    expect(body.risk.operationDangerLevel).toBe('medium')

    expect(deps.__testing.publishedSubjects()).toEqual([
      'task.requested.v0',
      'task.queued.v0',
      'task.dispatched.v0',
      'task.running.v0',
      'task.completed.v0'
    ])
    expect(deps.__testing.auditActions()).toContain('task.submit')
    expect(deps.__testing.timelineSummaries()).toContain(`completed noop task ${body.task.id}`)
  })

  it('lists, reads, and cancels queued M-Task requests', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', deliveryMode: 'queued' })
    const app = createMTaskApp(deps)

    const submit = await app.handle(new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ nodeId: 'node-leaf-1', type: 'noop' })
    }))
    const submitted = await submit.json() as { task: { id: string; status: string } }
    expect(submitted.task.status).toBe('queued')

    const list = await app.handle(new Request('http://localhost/api/v0/tasks', {
      headers: { authorization: 'Bearer operator-token' }
    }))
    const listed = await list.json() as { tasks: Array<{ id: string }> }
    expect(listed.tasks.map((task) => task.id)).toContain(submitted.task.id)

    const read = await app.handle(new Request(`http://localhost/api/v0/tasks/${submitted.task.id}`, {
      headers: { authorization: 'Bearer operator-token' }
    }))
    expect(read.status).toBe(200)

    const cancel = await app.handle(new Request(`http://localhost/api/v0/tasks/${submitted.task.id}/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))
    expect(cancel.status).toBe(200)
    const canceled = await cancel.json() as { task: { status: string }; risk: { operationDangerLevel: string } }
    expect(canceled.task.status).toBe('canceled')
    expect(canceled.risk.operationDangerLevel).toBe('high')
    expect(deps.__testing.publishedSubjects()).toContain('task.canceled.v0')
  })

  it('blocks high-risk retry execution when M-Policy requires manual review', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator', forcePolicyResult: 'require_manual_review' })
    const app = createMTaskApp(deps)

    const retry = await app.handle(new Request('http://localhost/api/v0/tasks/task-existing/retry', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))

    expect(retry.status).toBe(409)
    const body = await retry.json() as {
      policyDecision: { result: string; requiredAction: string; decisionId: string }
      risk: { operationDangerLevel: string; suspicionScore: number }
    }
    expect(body.policyDecision.result).toBe('require_manual_review')
    expect(body.policyDecision.requiredAction).toBe('manual_review')
    expect(body.risk.operationDangerLevel).toBe('high')
    expect(deps.__testing.publishedSubjects()).toEqual([])
    expect(deps.__testing.auditActions()).toContain('task.retry')
  })

  it('returns policy-aware not implemented for allowed retry requests', async () => {
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const app = createMTaskApp(deps)

    const retry = await app.handle(new Request('http://localhost/api/v0/tasks/task-existing/retry', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' }
    }))

    expect(retry.status).toBe(501)
    const body = await retry.json() as {
      error: { code: string }
      decisionId: string
      risk: { operationDangerLevel: string }
    }
    expect(body.error.code).toBe('not_implemented_for_phase')
    expect(body.decisionId.length).toBeGreaterThan(10)
    expect(body.risk.operationDangerLevel).toBe('high')
    expect(deps.__testing.fullMessages()).toContain('retry is not implemented in Phase 11')
  })
})
