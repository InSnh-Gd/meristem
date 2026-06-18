import { describe, expect, it } from 'bun:test'
import {
  acquireOperationLock,
  type NetworkOperationLock,
  type NetworkOperationRecord,
  type OperationLockRequest,
  preemptWithBreakGlass,
  registerIdempotentOperation,
  releaseOperationLock
} from '../../services/m-net/src/operation-locks.ts'
import {
  type NetworkPartitionState,
  type PartitionTransitionRequest,
  transitionPartitionState
} from '../../services/m-net/src/partition-state.ts'

const networkId = 'network-op-locks'
const acquiredAt = '2026-06-18T10:00:00.000Z'
const expiresAt = '2026-06-18T10:05:00.000Z'

function activeLock(overrides: Partial<NetworkOperationLock> = {}): NetworkOperationLock {
  return {
    networkId,
    operationType: 'migration',
    operationId: 'migration-001',
    acquiredAt,
    expiresAt,
    status: 'active',
    lockRowId: 'lock-row-001',
    fencingToken: 1,
    updatedAt: acquiredAt,
    ...overrides
  }
}

function operationRequest(overrides: Partial<OperationLockRequest> = {}): OperationLockRequest {
  return {
    networkId,
    operationType: 'apply',
    operationId: 'apply-001',
    idempotencyKey: 'idem-apply-001',
    requestedAt: '2026-06-18T10:01:00.000Z',
    ttlMs: 300_000,
    reason: { code: 'profile.apply', detail: 'enable target profile' },
    ...overrides
  }
}

function operationRecord(overrides: Partial<NetworkOperationRecord> = {}): NetworkOperationRecord {
  return {
    networkId,
    operationType: 'apply',
    operationId: 'apply-001',
    idempotencyKey: 'idem-apply-001',
    status: 'accepted',
    requestedAt: '2026-06-18T10:01:00.000Z',
    stateTransitionCount: 1,
    auditActionCount: 1,
    ...overrides
  }
}

function connectedState(overrides: Partial<NetworkPartitionState> = {}): NetworkPartitionState {
  return {
    networkId,
    state: 'connected',
    reason: { code: 'initial.connect', detail: 'healthy signed network map' },
    transitionedAt: acquiredAt,
    previousState: null,
    ...overrides
  }
}

function partitionRequest(
  overrides: Partial<PartitionTransitionRequest> = {}
): PartitionTransitionRequest {
  return {
    networkId,
    targetState: 'stale',
    reason: { code: 'network_map.stale', staleForMs: 901_000 },
    transitionedAt: '2026-06-18T10:20:00.000Z',
    ...overrides
  }
}

describe('M-Net operation locks failure modes', () => {
  it('break-glass preempts migration and records both operation ids', () => {
    const current = activeLock({ operationType: 'migration', operationId: 'migration-001' })

    const result = preemptWithBreakGlass(
      current,
      operationRequest({
        operationType: 'break_glass',
        operationId: 'break-glass-001',
        idempotencyKey: 'idem-break-glass-001',
        requestedAt: '2026-06-18T10:02:00.000Z',
        reason: { code: 'operator.break_glass', actor: 'security-admin', detail: 'policy outage' }
      })
    )

    expect(result.kind).toBe('preempted')
    if (result.kind !== 'preempted') return

    expect(result.interruptedLock.status).toBe('interrupted')
    expect(result.interruptedLock.operationId).toBe('migration-001')
    expect(result.breakGlassLock.status).toBe('active')
    expect(result.breakGlassLock.operationType).toBe('break_glass')
    expect(result.audit.interruptedOperationId).toBe('migration-001')
    expect(result.audit.preemptingOperationId).toBe('break-glass-001')
  })

  it('break-glass preempts apply and records both operation ids', () => {
    const current = activeLock({ operationType: 'apply', operationId: 'apply-001' })

    const result = preemptWithBreakGlass(
      current,
      operationRequest({
        operationType: 'break_glass',
        operationId: 'break-glass-apply-001',
        idempotencyKey: 'idem-break-glass-apply-001',
        requestedAt: '2026-06-18T10:02:00.000Z',
        reason: { code: 'operator.break_glass', actor: 'security-admin', detail: 'unsafe apply' }
      })
    )

    expect(result.kind).toBe('preempted')
    if (result.kind !== 'preempted') return

    expect(result.interruptedLock.status).toBe('interrupted')
    expect(result.interruptedLock.operationId).toBe('apply-001')
    expect(result.audit.interruptedOperationType).toBe('apply')
    expect(result.audit.preemptingOperationId).toBe('break-glass-apply-001')
  })

  it('idempotency returns the first apply operation without duplicate transition or audit', () => {
    const first = registerIdempotentOperation(operationRequest(), [])

    expect(first.kind).toBe('created')
    if (first.kind !== 'created') return

    expect(first.operation.stateTransitionCount).toBe(1)
    expect(first.operation.auditActionCount).toBe(1)

    const second = registerIdempotentOperation(
      operationRequest({ operationId: 'apply-duplicate-001' }),
      [first.operation]
    )

    expect(second.kind).toBe('duplicate')
    if (second.kind !== 'duplicate') return

    expect(second.originalOperationId).toBe(first.operation.operationId)
    expect(second.operation.operationId).toBe(first.operation.operationId)
    expect(second.stateTransitionCount).toBe(0)
    expect(second.auditActionCount).toBe(0)
  })

  it('concurrent disable versus migration allows one lock and rejects the other with typed failure', () => {
    const migration = acquireOperationLock({
      existingLock: null,
      request: operationRequest({
        operationType: 'migration',
        operationId: 'migration-concurrent-001',
        idempotencyKey: 'idem-migration-concurrent-001',
        reason: { code: 'profile.migration', detail: 'fleet switch' }
      })
    })

    expect(migration.kind).toBe('acquired')
    if (migration.kind !== 'acquired') return

    const disable = acquireOperationLock({
      existingLock: migration.lock,
      request: operationRequest({
        operationType: 'apply',
        operationId: 'disable-concurrent-001',
        idempotencyKey: 'idem-disable-concurrent-001',
        reason: { code: 'profile.disable', detail: 'disable active profile' }
      })
    })

    expect(disable.kind).toBe('failure')
    if (disable.kind !== 'failure') return
    expect(disable.failure.code).toBe('operation.locked')
    expect(disable.failure.activeOperationId).toBe('migration-concurrent-001')
  })

  it('partition state transitions carry typed reasons', () => {
    const stale = transitionPartitionState(
      connectedState(),
      partitionRequest({
        targetState: 'stale',
        reason: { code: 'network_map.stale', staleForMs: 901_000 }
      })
    )
    expect(stale.kind).toBe('transitioned')
    if (stale.kind !== 'transitioned') return
    expect(stale.state.state).toBe('stale')
    expect(stale.state.previousState).toBe('connected')
    expect(stale.state.reason.code).toBe('network_map.stale')

    const failedClosed = transitionPartitionState(
      stale.state,
      partitionRequest({
        targetState: 'fail_closed',
        transitionedAt: '2026-06-18T10:36:00.000Z',
        reason: { code: 'network_map.expired', expiredForMs: 1_860_000 }
      })
    )
    expect(failedClosed.kind).toBe('transitioned')
    if (failedClosed.kind !== 'transitioned') return
    expect(failedClosed.state.state).toBe('fail_closed')
    expect(failedClosed.state.previousState).toBe('stale')
    expect(failedClosed.state.reason.code).toBe('network_map.expired')

    const recovered = transitionPartitionState(
      failedClosed.state,
      partitionRequest({
        targetState: 'recovered',
        transitionedAt: '2026-06-18T10:40:00.000Z',
        reason: { code: 'network_map.refreshed', signedMapVersion: 'map-v2' }
      })
    )
    expect(recovered.kind).toBe('transitioned')
    if (recovered.kind !== 'transitioned') return
    expect(recovered.state.state).toBe('recovered')
    expect(recovered.state.previousState).toBe('fail_closed')
    expect(recovered.state.reason.code).toBe('network_map.refreshed')
  })

  it('completed operation releases lock and next operation can proceed', () => {
    const acquired = acquireOperationLock({ existingLock: null, request: operationRequest() })
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') return

    const released = releaseOperationLock(acquired.lock, {
      completedAt: '2026-06-18T10:03:00.000Z',
      reason: { code: 'operation.completed', detail: 'apply succeeded' }
    })
    expect(released.kind).toBe('released')
    if (released.kind !== 'released') return
    expect(released.lock.status).toBe('released')

    const next = acquireOperationLock({
      existingLock: released.lock,
      request: operationRequest({
        operationType: 'rotation',
        operationId: 'rotation-001',
        idempotencyKey: 'idem-rotation-001',
        requestedAt: '2026-06-18T10:04:00.000Z',
        reason: { code: 'credential.rotation', detail: 'rotate node key metadata' }
      })
    })
    expect(next.kind).toBe('acquired')
    if (next.kind !== 'acquired') return
    expect(next.lock.operationId).toBe('rotation-001')
  })

  it('stale lock timeout auto-expires with audit metadata before next acquire', () => {
    const staleLock = activeLock({
      operationId: 'apply-stale-001',
      operationType: 'apply',
      expiresAt: '2026-06-18T10:01:00.000Z'
    })

    const result = acquireOperationLock({
      existingLock: staleLock,
      request: operationRequest({
        operationType: 'rotation',
        operationId: 'rotation-after-stale-001',
        idempotencyKey: 'idem-rotation-after-stale-001',
        requestedAt: '2026-06-18T10:06:00.000Z',
        reason: { code: 'credential.rotation', detail: 'stale lock cleared first' }
      })
    })

    expect(result.kind).toBe('acquired')
    if (result.kind !== 'acquired') return
    expect(result.expiredLock?.status).toBe('expired')
    expect(result.audit.expiredOperationId).toBe('apply-stale-001')
    expect(result.lock.operationId).toBe('rotation-after-stale-001')
  })

  it('derives lock expiry from requestedAt plus ttlMs and expires at equality boundary', () => {
    const acquired = acquireOperationLock({
      existingLock: null,
      request: operationRequest({
        requestedAt: '2026-06-18T10:01:00.500Z',
        ttlMs: 1_500,
        operationId: 'apply-boundary-001'
      })
    })

    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') return
    expect(acquired.lock.expiresAt).toBe('2026-06-18T10:01:02.000Z')

    const next = acquireOperationLock({
      existingLock: acquired.lock,
      request: operationRequest({
        operationType: 'rotation',
        operationId: 'rotation-boundary-001',
        idempotencyKey: 'idem-rotation-boundary-001',
        requestedAt: '2026-06-18T10:01:02.000Z',
        reason: { code: 'credential.rotation', detail: 'boundary expiry' }
      })
    })

    expect(next.kind).toBe('acquired')
    if (next.kind !== 'acquired') return
    expect(next.expiredLock?.operationId).toBe('apply-boundary-001')
    expect(next.expiredLock?.status).toBe('expired')
  })

  it('existing idempotency record can be returned without recreating an operation', () => {
    const existing = operationRecord({ operationId: 'apply-existing-001' })
    const result = registerIdempotentOperation(
      operationRequest({ operationId: 'apply-retry-001' }),
      [existing]
    )

    expect(result.kind).toBe('duplicate')
    if (result.kind !== 'duplicate') return
    expect(result.originalOperationId).toBe('apply-existing-001')
    expect(result.stateTransitionCount).toBe(0)
    expect(result.auditActionCount).toBe(0)
  })
})
