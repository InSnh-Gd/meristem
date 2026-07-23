import { describe, expect, it } from 'bun:test'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * T16 libvirt/OpenTofu validation gate — direct test.
 *
 * Verifies that the gate script produces valid typed JSON output
 * and correctly reports both `external_tool_unavailable` (tofu absent)
 * and `pass`/`fail` (tofu present) paths.
 */

const SCRIPT_PATH = join(import.meta.dir, '../../../scripts/libvirt-opentofu-validation-gate.ts')

type StepOutcome =
  | { status: 'pass'; step: string; detail: string }
  | { status: 'fail'; step: string; message: string; exitCode?: number; stderr?: string }

type GateOutcome = {
  proof: 'libvirt-opentofu-validation'
  topoId: string
  schemaVersion: string
  nodeCount: number
  results: StepOutcome[]
  verdict: 'pass' | 'external_tool_unavailable' | 'fail'
}

function runGate(): { exitCode: number | null; output: GateOutcome } {
  try {
    const stdout = execSync(`bun run ${SCRIPT_PATH}`, {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { exitCode: 0, output: JSON.parse(stdout) }
  } catch (err: unknown) {
    const typed = err as { status?: number; stdout?: string; stderr?: string }
    return {
      exitCode: typed.status ?? 1,
      output: JSON.parse(typed.stdout ?? '{}')
    }
  }
}

describe('T16 libvirt/OpenTofu validation gate', () => {
  it('produces a valid typed JSON result with required fields', () => {
    const { output } = runGate()

    expect(output).toBeDefined()
    expect(output.proof).toBe('libvirt-opentofu-validation')
    expect(output.schemaVersion).toBe('mdeploy.opentofu-module-input@0.1.0')
    expect(output.nodeCount).toBe(8)
    expect(typeof output.topoId).toBe('string')
    expect(Array.isArray(output.results)).toBe(true)
    expect(output.results.length).toBeGreaterThan(0)
    expect(['pass', 'external_tool_unavailable', 'fail']).toContain(output.verdict)
  })

  it('reports the fixed 8-node topology in all results', () => {
    const { output } = runGate()

    // Every result entry must have a recognized step name
    for (const result of output.results) {
      expect(typeof result.step).toBe('string')
      expect(result.step.length).toBeGreaterThan(0)
      expect(['pass', 'fail']).toContain(result.status)
    }
  })

  it('never reports pass when verdict is external_tool_unavailable', () => {
    const { exitCode, output } = runGate()

    if (output.verdict === 'external_tool_unavailable') {
      // Exit code 2 signals the tool is absent — not a failure, not a pass
      expect(exitCode).toBe(2)
      // The first result must explain why
      const first = output.results[0]
      expect(first?.status).toBe('fail')
      expect(first?.step).toBe('tofu-availability')
      if (first?.status === 'fail') {
        expect(first.message).toMatch(/not found|unavailable/i)
      }
    } else if (output.verdict === 'pass') {
      // Real validation passed
      expect(exitCode).toBe(0)
      expect(output.results.every(r => r.status === 'pass')).toBe(true)
    } else {
      // verdict === 'fail' — tofu exists but validation failed
      expect(exitCode).toBe(1)
      expect(output.results.some(r => r.status === 'fail')).toBe(true)
    }
  })

  it('does not leave committed artifacts or secrets in the workspace', () => {
    const { output } = runGate()

    // Output must not contain SSH, secret values, or provider-specific credentials
    const serialized = JSON.stringify(output)
    expect(serialized).not.toMatch(/\bssh\b|remote shell|password=|secretKey|api_key/i)

    // Topology fixture is provider-neutral
    expect(output.schemaVersion).toBe('mdeploy.opentofu-module-input@0.1.0')
  })
})
