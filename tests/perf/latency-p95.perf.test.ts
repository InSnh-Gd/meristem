import { describe, it } from 'bun:test'

import { computeLatencyStats, type LatencyStats } from './helpers/perf-utils.ts'
import { nextProfileState } from '../../services/m-net/src/profile-state-machine.ts'
import { createEventEnvelope, validateEventEnvelope } from '../../packages/events/src/index.ts'
import { decidePermission } from '../../packages/policy/src/index.ts'
import { computeConfigHash } from '../../apps/core/src/config-state-machine.ts'
import { redactSecrets } from '../../packages/common/src/secret-redaction.ts'

const toUs = (ms: number) => (ms * 1000).toFixed(2)

function recordLatency(samples: number[], fn: () => void): void {
  const start = performance.now()
  fn()
  const elapsed = performance.now() - start
  samples.push(elapsed > 0 ? elapsed : Number.EPSILON)
}

async function recordAsyncLatency(samples: number[], fn: () => Promise<void>): Promise<void> {
  const start = performance.now()
  await fn()
  const elapsed = performance.now() - start
  samples.push(elapsed > 0 ? elapsed : Number.EPSILON)
}

function logLatency(name: string, s: LatencyStats): void {
  console.log(
    `[perf] ${name}: p50=${toUs(s.p50)}µs p95=${toUs(s.p95)}µs p99=${toUs(s.p99)}µs (${s.count} samples)`
  )
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} p95 must be a finite positive number`)
  }
}

describe('P95 latency benchmarks', () => {
  it('profile state machine transition latency', () => {
    const samples: number[] = []

    for (let i = 0; i < 10000; i++) {
      recordLatency(samples, () => {
        nextProfileState('enabling', 'enable_fail')
      })
    }

    const stats = computeLatencyStats(samples)
    logLatency('profile-sm-latency', stats)
    assertFinitePositive(stats.p95, 'profile-sm-latency')
  })

  it('event envelope creation latency', () => {
    const samples: number[] = []
    const validation = validateEventEnvelope(
      createEventEnvelope({ type: 'test', source: 'perf', payload: { x: 1 } })
    )

    if (!validation.ok) {
      throw new Error('event envelope validation must pass')
    }

    for (let i = 0; i < 5000; i++) {
      recordLatency(samples, () => {
        createEventEnvelope({ type: 'test', source: 'perf', payload: { x: 1 } })
      })
    }

    const stats = computeLatencyStats(samples)
    logLatency('event-envelope-latency', stats)
    if (!Number.isFinite(stats.p95) || stats.p95 >= 1000) {
      throw new Error('event-envelope-latency p95 must be under 1ms')
    }
  })

  it('policy decision latency', () => {
    const samples: number[] = []

    for (let i = 0; i < 10000; i++) {
      recordLatency(samples, () => {
        decidePermission({
          actor: 'admin',
          action: 'core:read',
          permissions: ['core:read', 'node:register']
        })
      })
    }

    const stats = computeLatencyStats(samples)
    logLatency('policy-decision-latency', stats)
    assertFinitePositive(stats.p95, 'policy-decision-latency')
  })

  it('config hash computation latency', async () => {
    const samples: number[] = []

    for (let i = 0; i < 100; i++) {
      await recordAsyncLatency(samples, async () => {
        await computeConfigHash({ key: 'value', nested: { a: 1, b: 2 }, items: [1, 2, 3] })
      })
    }

    const stats = computeLatencyStats(samples)
    logLatency('config-hash-latency', stats)
    if (!Number.isFinite(stats.p95) || stats.p95 >= 10000) {
      throw new Error('config-hash-latency p95 must be under 10ms')
    }
  })

  it('secret redaction latency', () => {
    const samples: number[] = []

    for (let i = 0; i < 5000; i++) {
      recordLatency(samples, () => {
        redactSecrets('value=secret123 token=abc "value":"hidden"')
      })
    }

    const stats = computeLatencyStats(samples)
    logLatency('secret-redaction-latency', stats)
    assertFinitePositive(stats.p95, 'secret-redaction-latency')
  })
})
