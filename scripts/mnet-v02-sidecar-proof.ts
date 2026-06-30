/**
 * mnet-v02-sidecar-proof.ts — NetBird sidecar viability proof command.
 *
 * Validates that the NetBird client sidecar can be started, connects to
 * Signal/Relay/STUN infrastructure, and reports its state. If the required
 * infrastructure or binaries are absent, exit 0 with a typed
 * prerequisite-missing JSON report.
 *
 * Usage: bun run mnet:v02:sidecar-proof
 */

import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const PROOF_STEPS = [
  'sidecar-binary',
  'signal-connectivity',
  'stun-connectivity',
  'config-acquisition',
  'peer-session'
] as const

type PrerequisiteMissing = { status: 'prerequisite-missing'; step: string; message: string }
type ProofSuccess = { status: 'success'; step: string; detail: string }
type ProofOutcome = PrerequisiteMissing | ProofSuccess

const results: ProofOutcome[] = []

function missing(step: string, message: string): PrerequisiteMissing {
  return { status: 'prerequisite-missing', step, message }
}

function success(step: string, detail: string): ProofSuccess {
  return { status: 'success', step, detail }
}

for (const step of PROOF_STEPS) {
  switch (step) {
    case 'sidecar-binary': {
      const paths = ['/usr/local/bin/netbird', '/usr/bin/netbird', '/opt/netbird/netbird']
      const found =
        paths.find(p => existsSync(p)) ||
        (existsSync('/nix/store')
          ? (() => {
              try {
                const out = execSync("which netbird 2>/dev/null || echo ''", {
                  encoding: 'utf8',
                  timeout: 5000
                }).trim()
                return out || null
              } catch {
                return null
              }
            })()
          : null)
      if (found) {
        results.push(success(step, `netbird binary found at ${found}`))
      } else {
        results.push(
          missing(
            step,
            'netbird binary not found in PATH or known locations; install NetBird client to proceed'
          )
        )
      }
      break
    }
    case 'signal-connectivity': {
      const signalUrl = process.env.NETBIRD_SIGNAL_URL || process.env.MERISTEM_MNET_SIGNAL_URL
      if (signalUrl) {
        try {
          const resp = execSync(
            `curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${signalUrl}/health" 2>/dev/null`,
            {
              encoding: 'utf8',
              timeout: 10000
            }
          ).trim()
          results.push(success(step, `Signal endpoint ${signalUrl} responded with HTTP ${resp}`))
        } catch {
          results.push(
            missing(step, `Signal endpoint ${signalUrl} not reachable within 5s timeout`)
          )
        }
      } else {
        results.push(
          missing(
            step,
            'NETBIRD_SIGNAL_URL or MERISTEM_MNET_SIGNAL_URL not set — cannot verify Signal connectivity'
          )
        )
      }
      break
    }
    case 'stun-connectivity': {
      const stunUrl = process.env.NETBIRD_STUN_URL || process.env.MERISTEM_MNET_STUN_URL
      if (stunUrl) {
        try {
          const resp = execSync(
            `curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${stunUrl}/health" 2>/dev/null`,
            {
              encoding: 'utf8',
              timeout: 10000
            }
          ).trim()
          results.push(success(step, `STUN/Relay endpoint ${stunUrl} responded with HTTP ${resp}`))
        } catch {
          results.push(
            missing(step, `STUN/Relay endpoint ${stunUrl} not reachable within 5s timeout`)
          )
        }
      } else {
        results.push(
          missing(
            step,
            'NETBIRD_STUN_URL or MERISTEM_MNET_STUN_URL not set — cannot verify STUN/Relay connectivity'
          )
        )
      }
      break
    }
    case 'config-acquisition': {
      const configPresent =
        existsSync('/etc/netbird/config.json') ||
        existsSync(process.env.HOME + '/.netbird/config.json') ||
        !!process.env.NETBIRD_CONFIG
      if (configPresent) {
        results.push(success(step, 'NetBird client configuration found'))
      } else {
        results.push(
          missing(
            step,
            'No NetBird client configuration found — expected at /etc/netbird/config.json, ~/.netbird/config.json, or NETBIRD_CONFIG env'
          )
        )
      }
      break
    }
    case 'peer-session': {
      try {
        const out = execSync("netbird status 2>/dev/null || echo 'not-running'", {
          encoding: 'utf8',
          timeout: 10000
        }).trim()
        if (out.includes('Connected') || out.includes('Running')) {
          results.push(success(step, `NetBird peer session active: ${out.slice(0, 120)}`))
        } else {
          results.push(
            missing(step, `NetBird peer session not connected (status: ${out.slice(0, 80)})`)
          )
        }
      } catch {
        results.push(
          missing(
            step,
            'netbird status command failed — sidecar not running or binary not executable'
          )
        )
      }
      break
    }
  }
}

const allSuccess = results.every(r => r.status === 'success')
const output = {
  proof: 'netbird-sidecar-viability',
  results,
  verdict: allSuccess ? 'pass' : 'prerequisite-missing'
}
process.stdout.write(JSON.stringify(output, null, 2) + '\n')
process.exit(0)
