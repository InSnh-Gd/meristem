/**
 * libvirt-opentofu-validation-gate.ts — T16 libvirt/OpenTofu validation gate.
 *
 * Generates the fixed 3 control/state + 3 search + 2 leaf topology,
 * runs `tofu init/validate/plan` when the external tool exists, and reports
 * a clearly typed `external_tool_unavailable` / environment skip when it does not.
 *
 * Usage: bun run mnet:libvirt-validation-gate
 *
 * Exit codes:
 *   0 — validation passed (tofu available and all commands succeeded)
 *   1 — validation failed (tofu available but one or more commands failed)
 *   2 — external tool unavailable (tofu not found in PATH)
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixed validation topology — 3 control/state + 3 search + 2 leaf
// ---------------------------------------------------------------------------

function generateTopology() {
  return {
    topologyId: 'libvirt-validation-fixture',
    revision: 't16-proof-1',
    network: { networkId: 'meristem-validation', cidr: '10.88.0.0/24' },
    nodes: [
      ...Array.from({ length: 3 }, (_, i) => ({
        nodeId: `control-state-${i + 1}`,
        workloadClass: 'control-state',
        failureDomain: `rack-${i + 1}`,
        resources: { vcpu: 4, memoryMiB: 8192, diskGiB: 100 },
        runtimeDriver: 'podman'
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        nodeId: `search-${i + 1}`,
        workloadClass: 'search',
        failureDomain: `rack-${i + 1}`,
        resources: { vcpu: 8, memoryMiB: 16384, diskGiB: 500 },
        runtimeDriver: 'podman'
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        nodeId: `leaf-${i + 1}`,
        workloadClass: 'leaf',
        failureDomain: `edge-${i + 1}`,
        resources: { vcpu: 2, memoryMiB: 4096, diskGiB: 50 },
        runtimeDriver: 'podman'
      }))
    ]
  }
}

// ---------------------------------------------------------------------------
// Tofu availability check
// ---------------------------------------------------------------------------

function findTofuBinary(): string | null {
  const knownPaths = ['/usr/local/bin/tofu', '/usr/bin/tofu', '/run/current-system/sw/bin/tofu']
  for (const p of knownPaths) {
    if (existsSync(p)) return p
  }
  try {
    const resolved = execSync('which tofu 2>/dev/null || echo ""', {
      encoding: 'utf8',
      timeout: 5000
    }).trim()
    return resolved || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Command execution helper
// ---------------------------------------------------------------------------

function runTofuCommand(
  label: string,
  args: string[],
  workDir: string,
  tofuPath: string
): StepOutcome {
  const cmd = [tofuPath, ...args].join(' ')
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return {
      status: 'pass',
      step: label,
      detail: stdout.trim().slice(0, 200) || `${label} succeeded`
    }
  } catch (err: unknown) {
    const exitCode = (err as { status?: number }).status ?? 1
    const stderr = (err as { stderr?: string }).stderr?.trim().slice(0, 300) ?? 'no stderr captured'
    return {
      status: 'fail',
      step: label,
      message: `${label} failed with exit code ${exitCode}`,
      exitCode,
      stderr
    }
  }
}

// ---------------------------------------------------------------------------
// Main gate
// ---------------------------------------------------------------------------

function writeTopoVarsFile(workDir: string, topology: ReturnType<typeof generateTopology>) {
  const varsContent = {
    schemaVersion: 'mdeploy.opentofu-module-input@0.1.0',
    topology,
    enable_libvirt_resources: false
  }
  writeFileSync(join(workDir, 'topology.auto.tfvars.json'), JSON.stringify(varsContent, null, 2))
}

function executeGate(): GateOutcome {
  const topology = generateTopology()
  const results: StepOutcome[] = []

  // Step 1: check tofu availability
  const tofuPath = findTofuBinary()
  if (!tofuPath) {
    return {
      proof: 'libvirt-opentofu-validation',
      topoId: topology.topologyId,
      schemaVersion: 'mdeploy.opentofu-module-input@0.1.0',
      nodeCount: topology.nodes.length,
      results: [
        {
          status: 'fail',
          step: 'tofu-availability',
          message: 'tofu binary not found in PATH or known locations'
        }
      ],
      verdict: 'external_tool_unavailable'
    }
  }
  results.push({ status: 'pass', step: 'tofu-availability', detail: `tofu found at ${tofuPath}` })

  // Step 2: prepare temp workspace with fixture files and topology vars
  const fixtureRoot = join(import.meta.dir, '../ops/m-deploy/open-tofu/libvirt')
  const workDir = mkdtempSync(join(tmpdir(), 'meristem-tofu-gate-'))

  try {
    cpSync(fixtureRoot, workDir, { recursive: true })
    writeTopoVarsFile(workDir, topology)

    // Step 3: tofu init
    const initResult = runTofuCommand('tofu-init', ['init', '-input=false'], workDir, tofuPath)
    results.push(initResult)
    if (initResult.status === 'fail') {
      return {
        proof: 'libvirt-opentofu-validation',
        topoId: topology.topologyId,
        schemaVersion: 'mdeploy.opentofu-module-input@0.1.0',
        nodeCount: topology.nodes.length,
        results,
        verdict: 'fail'
      }
    }

    // Step 4: tofu validate
    const validateResult = runTofuCommand('tofu-validate', ['validate'], workDir, tofuPath)
    results.push(validateResult)
    if (validateResult.status === 'fail') {
      return {
        proof: 'libvirt-opentofu-validation',
        topoId: topology.topologyId,
        schemaVersion: 'mdeploy.opentofu-module-input@0.1.0',
        nodeCount: topology.nodes.length,
        results,
        verdict: 'fail'
      }
    }

    // Step 5: tofu plan (resources disabled — static validation only)
    const planResult = runTofuCommand(
      'tofu-plan',
      ['plan', '-input=false', '-var=enable_libvirt_resources=false'],
      workDir,
      tofuPath
    )
    results.push(planResult)

    const allPassed = results.every(r => r.status === 'pass')
    return {
      proof: 'libvirt-opentofu-validation',
      topoId: topology.topologyId,
      schemaVersion: 'mdeploy.opentofu-module-input@0.1.0',
      nodeCount: topology.nodes.length,
      results,
      verdict: allPassed ? 'pass' : 'fail'
    }
  } finally {
    // Clean up temp workspace — never commit artifacts
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const outcome = executeGate()
process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`)

if (outcome.verdict === 'pass') process.exit(0)
if (outcome.verdict === 'external_tool_unavailable') process.exit(2)
process.exit(1)
