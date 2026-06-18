import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type ManagedProcess, startProcess, stopProcess } from '../helpers/process.ts'

type PreflightResult = {
  readonly ok: boolean
  readonly code: string
  readonly message: string
  readonly hint?: string
}

type HarnessStatus = {
  readonly active: boolean
  readonly controlPlane: {
    readonly ready: boolean
  }
  readonly issue?: PreflightResult
  readonly leafs: ReadonlyArray<{
    readonly found: boolean
    readonly leafName: string
    readonly logFile: string
    readonly status: string | null
  }>
  readonly logFiles: readonly string[]
  readonly relay: {
    readonly ready: boolean
  }
}

async function runHarnessCommand(
  args: readonly string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', ...args])
  const exitCode = await process.exited
  return {
    exitCode,
    stdout: process.stdout.trim(),
    stderr: process.stderr.trim()
  }
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T
}

const preflightOutput = await runHarnessCommand(['preflight'])
const preflight = parseJson<PreflightResult>(preflightOutput.stdout || '{}')
const harnessAvailable = preflight.ok && preflightOutput.exitCode === 0
const skippedTitle = harnessAvailable
  ? 'starts the first multi-host topology and reports three-host readiness'
  : `starts the first multi-host topology and reports three-host readiness (skip ${preflight.code})`

describe('e2e: m-net multi-host harness', () => {
  let startedHarness: ManagedProcess | null = null

  beforeAll(async () => {
    if (!harnessAvailable) return
    startedHarness = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'start'])
    const exitCode = await startedHarness.exited
    if (exitCode !== 0) {
      throw new Error(`multi-host harness start failed:\n${startedHarness.stderr}`)
    }
  }, 120_000)

  afterAll(async () => {
    await runHarnessCommand(['reset'])
    if (startedHarness) {
      await stopProcess(startedHarness)
    }
  }, 60_000)

  test.skipIf(!harnessAvailable)(
    skippedTitle,
    async () => {
      const statusOutput = await runHarnessCommand(['status'])
      expect(statusOutput.exitCode).toBe(0)
      const status = parseJson<HarnessStatus>(statusOutput.stdout)

      expect(status.active).toBe(true)
      expect(status.controlPlane.ready).toBe(true)
      expect(status.relay.ready).toBe(true)
      expect(status.leafs.length).toBe(2)
      expect(status.leafs.every(leaf => leaf.found)).toBe(true)
      expect(status.leafs.every(leaf => leaf.status === 'healthy')).toBe(true)
      expect(status.logFiles.length).toBeGreaterThanOrEqual(3)

      for (const logFile of status.logFiles) {
        expect(await Bun.file(logFile).exists()).toBe(true)
      }
    },
    120_000
  )

  test('reports a typed capability reason when the host cannot run the harness', () => {
    if (harnessAvailable) {
      expect(preflight.ok).toBe(true)
      return
    }

    expect(preflight.ok).toBe(false)
    expect(preflight.code).toMatch(/^[a-z0-9_.-]+$/)
    expect(preflight.message.length).toBeGreaterThan(0)
    expect((preflight.hint ?? '').length).toBeGreaterThan(0)
  })
})
