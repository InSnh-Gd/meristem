import { describe, it } from 'bun:test'
import * as Schema from 'effect/Schema'

import { permissions } from '../../packages/contracts/src/literals.ts'
import {
  HealthResponseSchema,
  MNodeSchema,
  NodeKindSchema
} from '../../packages/contracts/src/schemas/core.ts'
import {
  runBenchmark,
  aggregateRounds,
  computeLatencyStats,
  type BenchmarkResult
} from './helpers/perf-utils.ts'

function logBenchmark(name: string, aggregated: BenchmarkResult): void {
  const latencyUs = computeLatencyStats(
    aggregated.rounds.map(round => (round.totalMs / round.iterations) * 1000)
  )
  console.info(
    `[perf] ${name}: median=${aggregated.medianOpsPerSecond.toFixed(0)} ops/s, CV=${aggregated.coefficientOfVariation.toFixed(4)}, p95=${latencyUs.p95.toFixed(3)}µs/op`
  )
}

function assertPositiveMedian(aggregated: BenchmarkResult): void {
  if (aggregated.medianOpsPerSecond <= 0) {
    throw new Error(`${aggregated.name} median ops/s must be positive`)
  }
}

describe('Core HTTP performance', () => {
  it('Elysia schema validation throughput', async () => {
    const name = 'core-schema-validation'
    const validateHealth = Schema.decodeUnknownSync(HealthResponseSchema)
    const validateNode = Schema.decodeUnknownSync(MNodeSchema)
    const validateNodeKind = Schema.decodeUnknownSync(NodeKindSchema)
    const healthResponse = {
      ok: true,
      service: 'meristem-core',
      version: '0.1.0',
      uptimeMs: 12345
    }
    const nodeResponse = {
      id: 'stem-abc-123',
      kind: 'stem',
      name: 'stem-abc',
      mode: 'simulated',
      status: 'healthy',
      reachability: 'reachable',
      capabilities: ['network:join'],
      createdAt: '2026-06-15T00:00:00.000Z'
    }

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 20000,
      fn: () => {
        validateHealth(healthResponse)
        validateNode(nodeResponse)
        validateNodeKind('stem')
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('JSON response serialization throughput', async () => {
    const name = 'core-json-response-serialization'
    const healthResponse = {
      status: 'ok',
      uptime: 12345,
      version: '0.1.0',
      services: { 'm-net': 'online', 'm-log': 'online' }
    }

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 30000,
      fn: () => {
        JSON.stringify(healthResponse)
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('Route parameter parsing throughput', async () => {
    const name = 'core-route-parameter-parsing'
    const nodePath = '/nodes/stem-abc-123'

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 50000,
      fn: () => {
        const nodeId = nodePath.split('/').at(-1)
        if (nodeId !== 'stem-abc-123') {
          throw new Error(`unexpected node id ${nodeId ?? '<missing>'}`)
        }
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('Contract literal validation throughput', async () => {
    const name = 'core-contract-literal-validation'
    const nodeKinds = new Set(['core', 'stem', 'leaf'])
    const permissionSet = new Set<string>(permissions)

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 100000,
      fn: () => {
        nodeKinds.has('stem')
        permissionSet.has('node:register')
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })
})
