import type {
  DeploymentConfigV02FromSchema,
  NodeAgentDegradedReasonCode,
  NodeAgentRuntimeStatus
} from '../../../packages/contracts/src/index.ts'
import {
  evaluateSidecarState,
  validateSidecarConfigPath,
  type SidecarHealthProbe,
  type SidecarUnhealthyReason
} from './node-agent-sidecar.ts'
import {
  DEFAULT_SIDECAR_CONFIG_PATH,
  type SidecarLifecycleDependencies,
  type SidecarLifecycleInput
} from './node-agent-sidecar-lifecycle-types.ts'

type SidecarProcessState = NonNullable<SidecarLifecycleInput['currentProcess']>
type RuntimeSidecarDesiredState = SidecarLifecycleInput['desired']
type CommandResult = { exitCode: number; stdout: string; stderr: string }

type NetBirdLaunchConfig = {
  binaryPath: string
  managementUrl: string
  setupKey: string
}

const PROCESS_EXIT_POLL_MS = 25
const PROCESS_GRACEFUL_STOP_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function degradedReason(
  code: NodeAgentDegradedReasonCode,
  message: string,
  detail?: string
): NodeAgentRuntimeStatus['degradedReasons'][number] {
  return detail ? { code, message, detail } : { code, message }
}

function validateExecutablePath(
  path: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (path.trim().length === 0) return { ok: false, error: 'binary path is empty' }
  const validated = validateSidecarConfigPath(path)
  return validated.ok
    ? { ok: true, value: validated.value }
    : { ok: false, error: validated.error.reason }
}

function netbirdBinaryPath(env: NodeJS.ProcessEnv): string {
  return env.MERISTEM_NETBIRD_BINARY_PATH ?? 'netbird'
}

/** 在生成启动命令前拒绝无效二进制路径与缺失 setup key。 */
export function resolveNetBirdLaunchConfig(input: {
  env: NodeJS.ProcessEnv
  deploymentConfig: DeploymentConfigV02FromSchema
  setupKey: string | undefined
}):
  | { ok: true; value: NetBirdLaunchConfig }
  | { ok: false; reason: NodeAgentRuntimeStatus['degradedReasons'][number] } {
  const binary = validateExecutablePath(netbirdBinaryPath(input.env))
  if (!binary.ok) {
    return {
      ok: false,
      reason: degradedReason(
        'netbird.binary.invalid',
        'NetBird binary path is invalid',
        binary.error
      )
    }
  }
  if (!input.setupKey || input.setupKey.trim().length === 0) {
    return {
      ok: false,
      reason: degradedReason('netbird.setup_key.missing', 'NetBird setup key is unavailable')
    }
  }
  return {
    ok: true,
    value: {
      binaryPath: binary.value,
      managementUrl:
        input.env.MERISTEM_NETBIRD_MANAGEMENT_URL ?? input.deploymentConfig.netbird.signalEndpoint,
      setupKey: input.setupKey
    }
  }
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processIsRunning(
  deps: SidecarLifecycleDependencies,
  state: SidecarProcessState | undefined
): boolean {
  if (!state?.processPid) return false
  return (deps.isProcessRunning ?? defaultIsProcessRunning)(state.processPid)
}

function defaultKillProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // 进程已经消失时，停止语义已经满足。
  }
}

async function killProcess(
  deps: SidecarLifecycleDependencies,
  pid: number,
  signal: NodeJS.Signals
): Promise<void> {
  const kill =
    deps.killProcess ??
    (async (targetPid, targetSignal) => defaultKillProcess(targetPid, targetSignal))
  await kill(pid, signal)
}

async function waitForProcessExit(
  deps: SidecarLifecycleDependencies,
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const isRunning = deps.isProcessRunning ?? defaultIsProcessRunning
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return true
    await sleep(PROCESS_EXIT_POLL_MS)
  }
  return !isRunning(pid)
}

/** 仅在存在且仍运行的 sidecar PID 上执行 TERM/KILL 回收。 */
export async function stopSidecarProcessIfRunning(
  deps: SidecarLifecycleDependencies,
  state: SidecarProcessState | undefined
): Promise<void> {
  if (!state?.processPid || !processIsRunning(deps, state)) return
  await killProcess(deps, state.processPid, 'SIGTERM')
  const stopped = await waitForProcessExit(deps, state.processPid, PROCESS_GRACEFUL_STOP_MS)
  if (!stopped) {
    await killProcess(deps, state.processPid, 'SIGKILL')
    await waitForProcessExit(deps, state.processPid, PROCESS_GRACEFUL_STOP_MS)
  }
}

function startCommand(config: NetBirdLaunchConfig, sidecarConfigPath: string): readonly string[] {
  return [
    config.binaryPath,
    'up',
    '--management-url',
    config.managementUrl,
    '--setup-key',
    config.setupKey,
    '--config',
    sidecarConfigPath
  ]
}

async function defaultSpawnProcess(
  command: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ pid: number }> {
  const subprocess = Bun.spawn([...command], {
    env,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore'
  })
  return { pid: subprocess.pid }
}

async function spawnNetBirdProcess(input: {
  deps: SidecarLifecycleDependencies
  launch: NetBirdLaunchConfig
  process: SidecarProcessState
  env: NodeJS.ProcessEnv
  observedAt: string
}): Promise<
  | { ok: true; value: SidecarProcessState }
  | {
      ok: false
      reason: NodeAgentRuntimeStatus['degradedReasons'][number]
      process: SidecarProcessState
    }
> {
  const spawn = input.deps.spawnProcess ?? defaultSpawnProcess
  try {
    const started = await spawn(
      startCommand(input.launch, input.process.sidecarConfigPath ?? DEFAULT_SIDECAR_CONFIG_PATH),
      { ...input.env, MERISTEM_NETBIRD_CONFIG_HASH: input.process.configHash ?? '' }
    )
    return {
      ok: true,
      value: {
        ...input.process,
        processPid: started.pid,
        processStartedAt: input.observedAt,
        observedHealth: 'unknown'
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason: degradedReason(
        'netbird.start_failed',
        'NetBird client process failed to start',
        error instanceof Error ? error.message : String(error)
      ),
      process: input.process
    }
  }
}

async function defaultRunCommand(
  command: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<CommandResult> {
  const result = Bun.spawnSync([...command], { env, stdout: 'pipe', stderr: 'pipe' })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  }
}

function probeReason(result: CommandResult): SidecarUnhealthyReason {
  if (result.exitCode !== 0) return 'probe.failed'
  const normalized = `${result.stdout}\n${result.stderr}`.toLowerCase()
  return normalized.includes('timeout') ? 'probe.timeout' : 'probe.failed'
}

function parseProbeResult(result: CommandResult, probeAt: string): SidecarHealthProbe {
  const detail = (
    result.stdout.trim() ||
    result.stderr.trim() ||
    `netbird status exited ${result.exitCode}`
  ).slice(0, 400)
  if (result.exitCode !== 0) return { ok: false, probeAt, reason: probeReason(result), detail }
  const normalized = result.stdout.toLowerCase()
  if (
    normalized.includes('connected') ||
    normalized.includes('running') ||
    normalized.includes('healthy')
  ) {
    return { ok: true, probeAt, detail }
  }
  return { ok: false, probeAt, reason: 'probe.failed', detail }
}

async function probeNetBirdProcess(input: {
  deps: SidecarLifecycleDependencies
  launch: NetBirdLaunchConfig
  env: NodeJS.ProcessEnv
  process: SidecarProcessState
  observedAt: string
}): Promise<{
  process: SidecarProcessState
  reason?: NodeAgentRuntimeStatus['degradedReasons'][number]
}> {
  if (!processIsRunning(input.deps, input.process)) {
    const reason = degradedReason(
      'netbird.process.not_running',
      'NetBird client process is not running'
    )
    return {
      process: {
        ...input.process,
        lastProbeAt: input.observedAt,
        observedHealth: 'degraded',
        degradedReason: reason
      },
      reason
    }
  }
  const run = input.deps.runCommand ?? defaultRunCommand
  const result = await run([input.launch.binaryPath, 'status'], input.env)
  const probe = parseProbeResult(result, input.observedAt)
  const evaluation = evaluateSidecarState({ observedAt: input.observedAt, health: probe })
  if (evaluation.kind === 'unhealthy') {
    const reason = degradedReason(
      `netbird.${evaluation.finding.reason}`,
      evaluation.finding.message,
      evaluation.finding.detail
    )
    return {
      process: {
        ...input.process,
        lastProbeAt: input.observedAt,
        observedHealth: 'degraded',
        degradedReason: reason
      },
      reason
    }
  }
  const { degradedReason: _prevDegraded, ...restProcess } = input.process
  return { process: { ...restProcess, lastProbeAt: input.observedAt, observedHealth: 'healthy' } }
}

/**
 * 按期望态协调 NetBird 进程；禁止状态启动、配置漂移和进程异常都在同一受保护路径内收敛。
 */
export async function reconcileNetBirdProcess(input: {
  deps: SidecarLifecycleDependencies
  env: NodeJS.ProcessEnv
  desired: RuntimeSidecarDesiredState
  observedAt: string
  currentProcess: SidecarProcessState | undefined
  nextProcess: SidecarProcessState
  launch: NetBirdLaunchConfig
}): Promise<{ process: SidecarProcessState; reasons: NodeAgentRuntimeStatus['degradedReasons'] }> {
  const reasons: NodeAgentRuntimeStatus['degradedReasons'] = []
  const desiredConfigHash = input.nextProcess.configHash
  const appliedConfigHash = input.currentProcess?.configHash
  const drift = evaluateSidecarState({
    observedAt: input.observedAt,
    ...(desiredConfigHash ? { desiredConfigHash } : {}),
    ...(appliedConfigHash ? { appliedConfigHash } : {})
  })
  const hasDrift = drift.kind === 'drift_detected'
  const running = processIsRunning(input.deps, input.currentProcess)
  const shouldRun =
    input.desired.desiredState === 'start' || input.desired.desiredState === 'configure'

  if (!shouldRun) {
    await stopSidecarProcessIfRunning(input.deps, input.currentProcess)
    return { process: input.nextProcess, reasons }
  }
  if (hasDrift) {
    reasons.push(
      degradedReason(
        'netbird.config_drift_repaired',
        'NetBird config drift was detected and repaired'
      )
    )
    await stopSidecarProcessIfRunning(input.deps, input.currentProcess)
  } else if (!running && input.currentProcess?.processPid) {
    reasons.push(
      degradedReason(
        'netbird.process_restarted',
        'NetBird client stopped unexpectedly and was restarted'
      )
    )
  }

  const processToProbe =
    hasDrift || !running
      ? await spawnNetBirdProcess({
          deps: input.deps,
          launch: input.launch,
          process: input.nextProcess,
          env: input.env,
          observedAt: input.observedAt
        })
      : { ok: true as const, value: { ...input.nextProcess, ...input.currentProcess } }
  if (!processToProbe.ok) {
    return {
      process: {
        ...processToProbe.process,
        observedHealth: 'degraded',
        degradedReason: processToProbe.reason
      },
      reasons: [...reasons, processToProbe.reason]
    }
  }
  const probed = await probeNetBirdProcess({
    deps: input.deps,
    launch: input.launch,
    env: input.env,
    process: processToProbe.value,
    observedAt: input.observedAt
  })
  return { process: probed.process, reasons: probed.reason ? [...reasons, probed.reason] : reasons }
}
