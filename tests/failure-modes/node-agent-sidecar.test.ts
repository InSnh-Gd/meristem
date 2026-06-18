import { describe, expect, it } from 'bun:test'
import {
  buildSidecarCrashReport,
  evaluateSidecarState,
  type SidecarCrash,
  type SidecarLifecycleState,
  transitionSidecarLifecycle,
  validateSidecarConfigPath
} from '../../services/node-agent/src/node-agent-sidecar.ts'

function createIdleLifecycleState(): SidecarLifecycleState {
  return {
    kind: 'in_sync',
    desiredConfigHash: 'sha256:desired-1',
    appliedConfigHash: 'sha256:desired-1',
    observedAt: '2026-06-18T12:00:00.000Z'
  }
}

function createCrash(): SidecarCrash {
  return {
    crashedAt: '2026-06-18T12:01:00.000Z',
    exitCode: 137,
    signal: 'SIGKILL',
    stdout: 'relay stdout tail',
    stderr: 'relay stderr tail',
    message: 'wstunnel exited unexpectedly',
    logPayload: {
      unit: 'meristem-wstunnel.service',
      restartCount: 3
    }
  }
}

describe('node-agent sidecar failure modes', () => {
  it('returns in_sync when desired and applied config hashes match', () => {
    expect(
      evaluateSidecarState({
        observedAt: '2026-06-18T12:00:00.000Z',
        desiredConfigHash: 'sha256:desired-1',
        appliedConfigHash: 'sha256:desired-1',
        health: {
          probeAt: '2026-06-18T12:00:00.000Z',
          ok: true,
          detail: 'pid alive'
        }
      })
    ).toEqual({
      kind: 'in_sync',
      desiredConfigHash: 'sha256:desired-1',
      appliedConfigHash: 'sha256:desired-1',
      observedAt: '2026-06-18T12:00:00.000Z'
    })
  })

  it('returns drift_detected with typed finding when applied config hash differs', () => {
    expect(
      evaluateSidecarState({
        observedAt: '2026-06-18T12:01:00.000Z',
        desiredConfigHash: 'sha256:new',
        appliedConfigHash: 'sha256:old',
        health: {
          probeAt: '2026-06-18T12:01:00.000Z',
          ok: true,
          detail: 'pid alive'
        }
      })
    ).toEqual({
      kind: 'drift_detected',
      observedAt: '2026-06-18T12:01:00.000Z',
      desiredConfigHash: 'sha256:new',
      appliedConfigHash: 'sha256:old',
      finding: {
        code: 'sidecar.drift',
        message: 'sidecar config hash drift detected',
        desiredConfigHash: 'sha256:new',
        appliedConfigHash: 'sha256:old'
      }
    })
  })

  it('returns crashed with full log payload and tunnel not healthy when crash is reported', () => {
    const crash = createCrash()

    expect(
      evaluateSidecarState({
        observedAt: '2026-06-18T12:01:00.000Z',
        desiredConfigHash: 'sha256:desired-1',
        appliedConfigHash: 'sha256:desired-1',
        crash
      })
    ).toEqual({
      kind: 'crashed',
      observedAt: '2026-06-18T12:01:00.000Z',
      healthy: false,
      report: buildSidecarCrashReport(crash)
    })
  })

  it('returns recovered with audit metadata after a restart follows a crash', () => {
    const crashed = transitionSidecarLifecycle(createIdleLifecycleState(), {
      kind: 'sidecar_crashed',
      crash: createCrash()
    })

    const recovered = transitionSidecarLifecycle(crashed, {
      kind: 'sidecar_restarted',
      restartedAt: '2026-06-18T12:03:00.000Z',
      actor: 'node-agent',
      detail: 'systemd restart completed'
    })

    expect(recovered).toEqual({
      kind: 'recovered',
      recoveredAt: '2026-06-18T12:03:00.000Z',
      previousState: 'crashed',
      audit: {
        code: 'sidecar.recovered',
        actor: 'node-agent',
        detail: 'systemd restart completed',
        transitionedAt: '2026-06-18T12:03:00.000Z'
      }
    })
  })

  it('evaluates healthy and unhealthy probe outcomes with typed unhealthy reason', () => {
    expect(
      evaluateSidecarState({
        observedAt: '2026-06-18T12:04:00.000Z',
        health: {
          probeAt: '2026-06-18T12:04:00.000Z',
          ok: true,
          detail: 'local probe ok'
        }
      })
    ).toEqual({
      kind: 'healthy',
      observedAt: '2026-06-18T12:04:00.000Z',
      detail: 'local probe ok'
    })

    expect(
      evaluateSidecarState({
        observedAt: '2026-06-18T12:05:00.000Z',
        health: {
          probeAt: '2026-06-18T12:05:00.000Z',
          ok: false,
          reason: 'probe.timeout',
          detail: 'local health endpoint timed out'
        }
      })
    ).toEqual({
      kind: 'unhealthy',
      observedAt: '2026-06-18T12:05:00.000Z',
      finding: {
        code: 'sidecar.unhealthy',
        reason: 'probe.timeout',
        message: 'sidecar health probe failed',
        detail: 'local health endpoint timed out'
      }
    })
  })

  it('rejects config paths that contain traversal or shell metacharacters', () => {
    expect(validateSidecarConfigPath('/etc/meristem/../shadow')).toEqual({
      ok: false,
      error: {
        code: 'sidecar.invalid_path',
        reason: 'path.traversal',
        message: 'sidecar config path must stay within the declared directory boundary',
        path: '/etc/meristem/../shadow'
      }
    })

    expect(validateSidecarConfigPath('/etc/meristem/wstunnel.conf;rm -rf /')).toEqual({
      ok: false,
      error: {
        code: 'sidecar.invalid_path',
        reason: 'shell.metacharacter',
        message: 'sidecar config path contains forbidden shell metacharacters',
        path: '/etc/meristem/wstunnel.conf;rm -rf /'
      }
    })
  })
})
