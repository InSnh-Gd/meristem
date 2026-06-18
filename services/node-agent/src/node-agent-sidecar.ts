export type SidecarDriftFinding = {
  readonly code: 'sidecar.drift'
  readonly message: 'sidecar config hash drift detected'
  readonly desiredConfigHash: string
  readonly appliedConfigHash: string
}

export type SidecarUnhealthyReason =
  | 'probe.timeout'
  | 'probe.failed'
  | 'process.not_running'
  | 'endpoint.unreachable'

export type SidecarUnhealthyFinding = {
  readonly code: 'sidecar.unhealthy'
  readonly reason: SidecarUnhealthyReason
  readonly message: 'sidecar health probe failed'
  readonly detail: string
}

export type SidecarInvalidPathReason = 'path.traversal' | 'shell.metacharacter'

export type SidecarInvalidPathError = {
  readonly code: 'sidecar.invalid_path'
  readonly reason: SidecarInvalidPathReason
  readonly message:
    | 'sidecar config path must stay within the declared directory boundary'
    | 'sidecar config path contains forbidden shell metacharacters'
  readonly path: string
}

export type PathValidationResult =
  | {
      readonly ok: true
      readonly value: string
    }
  | {
      readonly ok: false
      readonly error: SidecarInvalidPathError
    }

export type SidecarCrash = {
  readonly crashedAt: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly message: string
  readonly logPayload: Record<string, unknown>
}

export type SidecarCrashReport = {
  readonly code: 'sidecar.crashed'
  readonly crashedAt: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly message: string
  readonly stdout: string
  readonly stderr: string
  readonly logPayload: Record<string, unknown>
}

export type SidecarHealthProbe =
  | {
      readonly probeAt: string
      readonly ok: true
      readonly detail: string
    }
  | {
      readonly probeAt: string
      readonly ok: false
      readonly reason: SidecarUnhealthyReason
      readonly detail: string
    }

export type SidecarStateInput = {
  readonly observedAt: string
  readonly desiredConfigHash?: string
  readonly appliedConfigHash?: string
  readonly health?: SidecarHealthProbe
  readonly crash?: SidecarCrash
}

export type SidecarStateResult =
  | {
      readonly kind: 'in_sync'
      readonly observedAt: string
      readonly desiredConfigHash: string
      readonly appliedConfigHash: string
    }
  | {
      readonly kind: 'drift_detected'
      readonly observedAt: string
      readonly desiredConfigHash: string
      readonly appliedConfigHash: string
      readonly finding: SidecarDriftFinding
    }
  | {
      readonly kind: 'crashed'
      readonly observedAt: string
      readonly healthy: false
      readonly report: SidecarCrashReport
    }
  | {
      readonly kind: 'healthy'
      readonly observedAt: string
      readonly detail: string
    }
  | {
      readonly kind: 'unhealthy'
      readonly observedAt: string
      readonly finding: SidecarUnhealthyFinding
    }

export type SidecarRecoveryAudit = {
  readonly code: 'sidecar.recovered'
  readonly actor: string
  readonly detail: string
  readonly transitionedAt: string
}

export type SidecarLifecycleState =
  | {
      readonly kind: 'in_sync'
      readonly desiredConfigHash: string
      readonly appliedConfigHash: string
      readonly observedAt: string
    }
  | {
      readonly kind: 'drift_detected'
      readonly desiredConfigHash: string
      readonly appliedConfigHash: string
      readonly observedAt: string
      readonly finding: SidecarDriftFinding
    }
  | {
      readonly kind: 'crashed'
      readonly crashedAt: string
      readonly report: SidecarCrashReport
      readonly healthy: false
    }
  | {
      readonly kind: 'recovering'
      readonly startedAt: string
      readonly previousState: 'crashed' | 'unhealthy'
      readonly detail: string
    }
  | {
      readonly kind: 'healthy'
      readonly observedAt: string
      readonly detail: string
    }
  | {
      readonly kind: 'unhealthy'
      readonly observedAt: string
      readonly finding: SidecarUnhealthyFinding
    }
  | {
      readonly kind: 'recovered'
      readonly recoveredAt: string
      readonly previousState: 'crashed' | 'recovering'
      readonly audit: SidecarRecoveryAudit
    }

export type SidecarEvent =
  | {
      readonly kind: 'config_evaluated'
      readonly result: SidecarStateResult
    }
  | {
      readonly kind: 'sidecar_crashed'
      readonly crash: SidecarCrash
    }
  | {
      readonly kind: 'sidecar_restart_started'
      readonly startedAt: string
      readonly detail: string
    }
  | {
      readonly kind: 'sidecar_restarted'
      readonly restartedAt: string
      readonly actor: string
      readonly detail: string
    }

const SHELL_METACHARACTER_PATTERN = /[;&|`$<>\\]/

function buildDriftFinding(
  desiredConfigHash: string,
  appliedConfigHash: string
): SidecarDriftFinding {
  return {
    code: 'sidecar.drift',
    message: 'sidecar config hash drift detected',
    desiredConfigHash,
    appliedConfigHash
  }
}

function buildUnhealthyFinding(
  probe: Extract<SidecarHealthProbe, { ok: false }>
): SidecarUnhealthyFinding {
  return {
    code: 'sidecar.unhealthy',
    reason: probe.reason,
    message: 'sidecar health probe failed',
    detail: probe.detail
  }
}

function hasTraversalSegment(path: string): boolean {
  return path.split('/').some(segment => segment === '..')
}

function toLifecycleState(result: SidecarStateResult): SidecarLifecycleState {
  switch (result.kind) {
    case 'in_sync':
      return result
    case 'drift_detected':
      return result
    case 'crashed':
      return {
        kind: 'crashed',
        crashedAt: result.report.crashedAt,
        report: result.report,
        healthy: false
      }
    case 'healthy':
      return result
    case 'unhealthy':
      return result
  }
}

/**
 * 评估 sidecar 的观测输入，只产出纯状态结论，不执行健康探测、重启或日志写入。
 */
export function evaluateSidecarState(input: SidecarStateInput): SidecarStateResult {
  if (input.crash) {
    return {
      kind: 'crashed',
      observedAt: input.observedAt,
      healthy: false,
      report: buildSidecarCrashReport(input.crash)
    }
  }

  const { desiredConfigHash, appliedConfigHash } = input
  if (desiredConfigHash !== undefined && appliedConfigHash !== undefined) {
    if (desiredConfigHash === appliedConfigHash) {
      return {
        kind: 'in_sync',
        observedAt: input.observedAt,
        desiredConfigHash,
        appliedConfigHash
      }
    }

    return {
      kind: 'drift_detected',
      observedAt: input.observedAt,
      desiredConfigHash,
      appliedConfigHash,
      finding: buildDriftFinding(desiredConfigHash, appliedConfigHash)
    }
  }

  if (input.health?.ok === true) {
    return {
      kind: 'healthy',
      observedAt: input.observedAt,
      detail: input.health.detail
    }
  }

  if (input.health?.ok === false) {
    return {
      kind: 'unhealthy',
      observedAt: input.observedAt,
      finding: buildUnhealthyFinding(input.health)
    }
  }

  return {
    kind: 'healthy',
    observedAt: input.observedAt,
    detail: 'no explicit sidecar failure observed'
  }
}

/**
 * 计算 sidecar 生命周期状态转换；非法或无效事件保持当前状态，外层运行时再决定是否执行重启动作。
 */
export function transitionSidecarLifecycle(
  current: SidecarLifecycleState,
  event: SidecarEvent
): SidecarLifecycleState {
  switch (event.kind) {
    case 'config_evaluated':
      return toLifecycleState(event.result)
    case 'sidecar_crashed':
      return {
        kind: 'crashed',
        crashedAt: event.crash.crashedAt,
        report: buildSidecarCrashReport(event.crash),
        healthy: false
      }
    case 'sidecar_restart_started':
      if (current.kind === 'crashed' || current.kind === 'unhealthy') {
        return {
          kind: 'recovering',
          startedAt: event.startedAt,
          previousState: current.kind,
          detail: event.detail
        }
      }
      return current
    case 'sidecar_restarted':
      if (current.kind === 'crashed' || current.kind === 'recovering') {
        return {
          kind: 'recovered',
          recoveredAt: event.restartedAt,
          previousState: current.kind,
          audit: {
            code: 'sidecar.recovered',
            actor: event.actor,
            detail: event.detail,
            transitionedAt: event.restartedAt
          }
        }
      }
      return current
  }
}

/**
 * 校验 sidecar 配置文件路径，阻止目录穿越与 shell 元字符进入后续命令拼装边界。
 */
export function validateSidecarConfigPath(path: string): PathValidationResult {
  if (hasTraversalSegment(path)) {
    return {
      ok: false,
      error: {
        code: 'sidecar.invalid_path',
        reason: 'path.traversal',
        message: 'sidecar config path must stay within the declared directory boundary',
        path
      }
    }
  }

  if (SHELL_METACHARACTER_PATTERN.test(path)) {
    return {
      ok: false,
      error: {
        code: 'sidecar.invalid_path',
        reason: 'shell.metacharacter',
        message: 'sidecar config path contains forbidden shell metacharacters',
        path
      }
    }
  }

  return {
    ok: true,
    value: path
  }
}

/**
 * 组装 sidecar 崩溃报告的结构化负载，供外层日志与降级状态上报复用。
 */
export function buildSidecarCrashReport(crash: SidecarCrash): SidecarCrashReport {
  return {
    code: 'sidecar.crashed',
    crashedAt: crash.crashedAt,
    exitCode: crash.exitCode,
    signal: crash.signal,
    message: crash.message,
    stdout: crash.stdout,
    stderr: crash.stderr,
    logPayload: { ...crash.logPayload }
  }
}
