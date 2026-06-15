import { describe, it } from 'bun:test'
import {
  runBenchmark,
  aggregateRounds,
  evaluateBenchmarkGate,
  tempFilePath,
  type BenchmarkResult
} from './helpers/perf-utils.ts'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'

function reportAndAssert(name: string, aggregated: BenchmarkResult): void {
  console.log(
    `[perf] ${name}: median=${aggregated.medianOpsPerSecond.toFixed(0)} ops/s, CV=${aggregated.coefficientOfVariation.toFixed(4)}`
  )

  if (aggregated.medianOpsPerSecond <= 0) {
    throw new Error(`${name} median ops/sec must be greater than 0`)
  }

  const gate = evaluateBenchmarkGate(aggregated, null, {
    maxCV: Number.POSITIVE_INFINITY,
    maxMedianRegression: 1
  })
  if (!gate.passed) {
    throw new Error(`${name} benchmark sanity gate failed: ${gate.reasons.join('; ')}`)
  }
}

describe('CPU micro-benchmarks', () => {
  it('json-stringify-parse', async () => {
    const name = 'json-stringify-parse'
    const results = await runBenchmark({
      name,
      warmupRounds: 2,
      measuredRounds: 5,
      iterationsPerRound: 20_000,
      fn: () => {
        const encoded = JSON.stringify({
          id: 1,
          name: 'test',
          data: [1, 2, 3],
          nested: { a: 1 }
        })
        JSON.parse(encoded)
      }
    })
    const aggregated = aggregateRounds(name, results)

    reportAndAssert(name, aggregated)
  })

  it('uint8array-copy', async () => {
    const name = 'uint8array-copy'
    const results = await runBenchmark({
      name,
      warmupRounds: 2,
      measuredRounds: 5,
      iterationsPerRound: 50_000,
      fn: () => {
        new Uint8Array(4096).fill(0xab).slice()
      }
    })
    const aggregated = aggregateRounds(name, results)

    reportAndAssert(name, aggregated)
  })

  it('text-encode-decode', async () => {
    const name = 'text-encode-decode'
    const results = await runBenchmark({
      name,
      warmupRounds: 2,
      measuredRounds: 5,
      iterationsPerRound: 50_000,
      fn: () => {
        const encoded = new TextEncoder().encode('hello world')
        new TextDecoder().decode(encoded)
      }
    })
    const aggregated = aggregateRounds(name, results)

    reportAndAssert(name, aggregated)
  })

  it('file-io', async () => {
    const name = 'file-io'
    const payload = new Uint8Array(4096).fill(0xab)
    const path = tempFilePath(name)
    const directory = path.slice(0, path.lastIndexOf('/'))
    mkdirSync(directory, { recursive: true })
    const results = await runBenchmark({
      name,
      warmupRounds: 2,
      measuredRounds: 5,
      iterationsPerRound: 800,
      fn: () => {
        writeFileSync(path, payload)
        readFileSync(path)
        rmSync(path)
      }
    })
    const aggregated = aggregateRounds(name, results)

    reportAndAssert(name, aggregated)
  })
})
