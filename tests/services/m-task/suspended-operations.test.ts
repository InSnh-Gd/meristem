import { describe, expect, it } from 'bun:test'
import { createInMemorySuspendedOperationStore } from '../../../services/m-task/src/suspended-operations.ts'

describe('createInMemorySuspendedOperationStore', () => {
  it('creates and reads suspended operations', async () => {
    const store = createInMemorySuspendedOperationStore()
    const operation = await store.create({
      policyDecisionId: 'decision-1',
      action: 'task.retry',
      requestedBy: 'operator',
      resource: 'suspend-op-resource-demo',
      sanitizedPayload: { retry: true },
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: '2026-01-02T03:04:05.000Z'
    })

    expect(operation.id.length).toBeGreaterThan(0)
    expect(operation.policyDecisionId).toBe('decision-1')
    expect(operation.action).toBe('task.retry')
    expect(operation.requestedBy).toBe('operator')
    expect(operation.resource).toBe('suspend-op-resource-demo')
    expect(operation.sanitizedPayload).toEqual({ retry: true })
    expect(operation.correlationId).toBe('corr-1')
    expect(operation.idempotencyKey).toBe('idem-1')
    expect(operation.status).toBe('suspended')
    expect(operation.expiresAt).toBe('2026-01-02T03:04:05.000Z')
    expect(await store.get(operation.id)).toBe(operation)
    expect(await store.get('missing')).toBeNull()
  })

  it('finds operations by policy decision id and status', async () => {
    const store = createInMemorySuspendedOperationStore()
    const first = await store.create({
      policyDecisionId: 'decision-1',
      action: 'task.retry',
      requestedBy: 'operator',
      resource: 'suspend-op-resource-demo',
      sanitizedPayload: null,
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: '2026-01-02T03:04:05.000Z'
    })
    const second = await store.create({
      policyDecisionId: 'decision-2',
      action: 'task.retry',
      requestedBy: 'operator',
      resource: 'suspend-op-resource-alt',
      sanitizedPayload: null,
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      expiresAt: '2026-01-03T03:04:05.000Z'
    })

    expect(await store.getByPolicyDecisionId('decision-2')).toBe(second)
    expect(await store.getByPolicyDecisionId('missing')).toBeNull()
    expect(await store.listByStatus('suspended')).toEqual([first, second])

    await store.transition(first.id, 'resumed')

    expect(await store.listByStatus('suspended')).toEqual([second])
    expect(await store.listByStatus('resumed')).toEqual([first])
  })

  it('transitions operations and preserves terminal reason', async () => {
    const store = createInMemorySuspendedOperationStore()
    const operation = await store.create({
      policyDecisionId: 'decision-1',
      action: 'task.retry',
      requestedBy: 'operator',
      resource: 'suspend-op-resource-demo',
      sanitizedPayload: null,
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: '2026-01-02T03:04:05.000Z'
    })

    const resumed = await store.transition(operation.id, 'resumed', 'approved')

    expect(resumed).toBe(operation)
    expect(operation.status).toBe('resumed')
    expect(operation.resumedAt).toEqual(expect.any(String))
    expect(operation.terminalReason).toBe('approved')
    expect(await store.transition('missing', 'resumed')).toBeNull()
  })

  it('returns immutable testing snapshots', async () => {
    const store = createInMemorySuspendedOperationStore()
    const operation = await store.create({
      policyDecisionId: 'decision-1',
      action: 'task.retry',
      requestedBy: 'operator',
      resource: 'suspend-op-resource-demo',
      sanitizedPayload: null,
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: '2026-01-02T03:04:05.000Z'
    })
    const snapshot = store.__testing.all()

    snapshot.length = 0

    expect(store.__testing.all()).toEqual([operation])
  })
})
