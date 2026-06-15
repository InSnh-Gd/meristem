import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface RoundResult {
  name: string
  totalMs: number
  opsPerSecond: number
  iterations: number
}

export interface LatencyStats {
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  p99: number
  count: number
}

export interface BenchmarkResult {
  name: string
  rounds: RoundResult[]
  medianOpsPerSecond: number
  trimmedMeanOpsPerSecond: number | null
  coefficientOfVariation: number
  minOpsPerSecond: number
  maxOpsPerSecond: number
}

export function computeLatencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    count: sorted.length
  }
}

function percentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[], avg: number): number {
  if (values.length <= 1) return 0
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function aggregateRounds(name: string, rounds: RoundResult[]): BenchmarkResult {
  const opsValues = rounds.map(r => r.opsPerSecond)
  const sorted = [...opsValues].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianVal = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!

  let trimmedMeanVal: number | null = null
  if (opsValues.length >= 4) {
    const trimmed = sorted.slice(1, sorted.length - 1)
    trimmedMeanVal = mean(trimmed)
  }

  const avg = mean(opsValues)
  const sd = stddev(opsValues, avg)
  const cv = avg > 0 ? sd / avg : 0

  return {
    name,
    rounds,
    medianOpsPerSecond: medianVal,
    trimmedMeanOpsPerSecond: trimmedMeanVal,
    coefficientOfVariation: cv,
    minOpsPerSecond: sorted[0]!,
    maxOpsPerSecond: sorted[sorted.length - 1]!
  }
}

export interface RunBenchmarkOptions {
  name: string
  warmupRounds: number
  measuredRounds: number
  iterationsPerRound: number
  fn: () => void | Promise<void>
}

export async function runBenchmark(options: RunBenchmarkOptions): Promise<RoundResult[]> {
  const { name, warmupRounds, measuredRounds, iterationsPerRound, fn } = options
  const results: RoundResult[] = []

  for (let i = 0; i < warmupRounds; i++) {
    for (let j = 0; j < iterationsPerRound; j++) {
      await fn()
    }
  }

  for (let i = 0; i < measuredRounds; i++) {
    const start = performance.now()
    for (let j = 0; j < iterationsPerRound; j++) {
      await fn()
    }
    const totalMs = performance.now() - start
    results.push({
      name: `${name} round ${i + 1}`,
      totalMs,
      opsPerSecond: (iterationsPerRound / totalMs) * 1000,
      iterations: iterationsPerRound
    })
  }

  return results
}

export interface BenchmarkGate {
  maxCV: number
  maxMedianRegression: number
}

export function evaluateBenchmarkGate(
  result: BenchmarkResult,
  baseline: BenchmarkResult | null,
  gate: BenchmarkGate = { maxCV: 0.35, maxMedianRegression: 0.2 }
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (result.coefficientOfVariation > gate.maxCV) {
    reasons.push(`CV ${result.coefficientOfVariation.toFixed(3)} > ${gate.maxCV}`)
  }

  if (
    baseline &&
    result.medianOpsPerSecond < baseline.medianOpsPerSecond * (1 - gate.maxMedianRegression)
  ) {
    reasons.push(
      `median regression ${((1 - result.medianOpsPerSecond / baseline.medianOpsPerSecond) * 100).toFixed(1)}% > ${(gate.maxMedianRegression * 100).toFixed(0)}%`
    )
  }

  return { passed: reasons.length === 0, reasons }
}

export function tempFilePath(label: string): string {
  const dir = join(tmpdir(), 'meristem-perf')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${label}-${Date.now()}.tmp`)
}

export function writeBenchmarkReport(results: BenchmarkResult[], outPath: string): void {
  const report = {
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      name: r.name,
      medianOpsPerSecond: r.medianOpsPerSecond,
      trimmedMeanOpsPerSecond: r.trimmedMeanOpsPerSecond,
      coefficientOfVariation: r.coefficientOfVariation,
      minOpsPerSecond: r.minOpsPerSecond,
      maxOpsPerSecond: r.maxOpsPerSecond,
      rounds: r.rounds.length
    }))
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')
}
