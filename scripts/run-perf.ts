import { $ } from 'bun'

const RUNS = Number(Bun.argv[2]) || 5
const TIMEOUT = 120_000

type MetricValue = { values: number[]; unit: string }
type RunMetrics = Map<string, MetricValue>

function parsePerfLine(
  line: string
): { name: string; metrics: Record<string, { value: number; unit: string }> } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[perf]')) return null

  const headerEnd = trimmed.indexOf(':')
  if (headerEnd === -1) return null

  const name = trimmed.slice(6, headerEnd).trim()
  const body = trimmed.slice(headerEnd + 1).trim()
  const metrics: Record<string, { value: number; unit: string }> = {}

  const parts = body.split(/\s+/)
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue

    const key = part.slice(0, eqIdx)
    const raw = part.slice(eqIdx + 1)

    const numMatch = raw.match(/^([\d.]+)(.*)/)
    if (!numMatch) continue

    const value = Number(numMatch[1])
    if (Number.isNaN(value)) continue

    metrics[key] = { value, unit: numMatch[2] || '' }
  }

  if (Object.keys(metrics).length === 0) return null
  return { name, metrics }
}

function computeStats(values: number[]): {
  mean: number
  stddev: number
  min: number
  max: number
} {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = sum / values.length
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  if (values.length <= 1) return { mean, stddev: 0, min, max }
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return { mean, stddev: Math.sqrt(variance), min, max }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n < 1 ? n.toFixed(2) : n.toFixed(0)
}

function formatWithUnit(value: number, unit: string, decimals: number): string {
  const v = value < 1 && value > 0 ? value.toFixed(2) : value.toFixed(decimals)
  return `${v}${unit}`
}

console.log(`\nRunning perf tests ${RUNS} times for stable aggregation...\n`)

const allRuns: RunMetrics[] = []

for (let run = 1; run <= RUNS; run++) {
  process.stdout.write(`  Run ${run}/${RUNS}... `)
  const start = performance.now()

  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', '--timeout=60000', 'tests/perf'],
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const elapsed = ((performance.now() - start) / 1000).toFixed(1)
  const output = new TextDecoder().decode(proc.stdout)
  const failed = proc.exitCode !== 0

  if (failed) {
    console.log(`FAILED (${elapsed}s)`)
    const stderr = new TextDecoder().decode(proc.stderr)
    console.error(stderr.split('\n').slice(0, 5).join('\n'))
    continue
  }

  const runMetrics: RunMetrics = new Map()
  for (const line of output.split('\n')) {
    const parsed = parsePerfLine(line)
    if (!parsed) continue
    for (const [key, { value, unit }] of Object.entries(parsed.metrics)) {
      const metricKey = `${parsed.name}:${key}`
      let entry = runMetrics.get(metricKey)
      if (!entry) {
        entry = { values: [], unit }
        runMetrics.set(metricKey, entry)
      }
      entry.values.push(value)
    }
  }

  console.log(`${runMetrics.size} metrics (${elapsed}s)`)
  allRuns.push(runMetrics)
}

const stableCount = allRuns.length
if (stableCount === 0) {
  console.error('\nNo stable runs completed.')
  process.exit(1)
}

const globalMetrics = new Map<string, { means: number[]; unit: string }>()
for (const run of allRuns) {
  for (const [key, metric] of run) {
    if (metric.values.length === 0) continue
    const avg = metric.values.reduce((a, b) => a + b, 0) / metric.values.length
    let entry = globalMetrics.get(key)
    if (!entry) {
      entry = { means: [], unit: metric.unit }
      globalMetrics.set(key, entry)
    }
    entry.means.push(avg)
  }
}

console.log(`\n=== Stable Performance Report (${stableCount} runs) ===\n`)

const groups = new Map<string, string[]>()
for (const key of globalMetrics.keys()) {
  const group = key.split(':')[0]!
  let keys = groups.get(group)
  if (!keys) {
    keys = []
    groups.set(group, keys)
  }
  keys.push(key)
}

for (const [group, keys] of groups) {
  console.log(`  ${group}:`)
  for (const key of keys) {
    const entry = globalMetrics.get(key)!
    const stats = computeStats(entry.means)
    const metricName = key.split(':').slice(1).join(':')
    const cv = stats.mean > 0 ? stats.stddev / stats.mean : 0
    const stability = cv < 0.05 ? '✓' : cv < 0.15 ? '~' : '✗'
    console.log(
      `    ${metricName.padEnd(16)} ${formatWithUnit(stats.min, entry.unit, 2).padStart(8)} .. ${formatWithUnit(stats.max, entry.unit, 2).padStart(8)}  mean=${formatWithUnit(stats.mean, entry.unit, 2)}  cv=${cv.toFixed(4)} ${stability}`
    )
  }
  console.log()
}

console.log(`Stability key: ✓ CV<5%  ~ CV<15%  ✗ CV≥15%`)
