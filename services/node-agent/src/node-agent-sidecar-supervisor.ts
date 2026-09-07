/**
 * NetBird 客户端 sidecar 进程监督器（ADR-N04 决策 5 的运行时实现）。
 *
 * 职责边界：
 * - 只负责进程生命周期：spawn、崩溃检测、按退避策略重启、优雅停止；
 * - 凭证与 endpoint 不进入进程 argv：客户端凭证由 node-agent-sidecar-lifecycle
 *   以 SecretRef 规则写入本地配置文件，监督器只把配置文件路径传给客户端；
 * - 状态转换全部复用 `node-agent-sidecar.ts` 的纯状态机，本模块只产出事件与执行动作；
 * - 默认 argv 为 `up --config <path>`，可用 MERISTEM_NETBIRD_CLIENT_ARGS 覆盖，
 *   以适配具体 NetBird 客户端的无 Management 启动接口（viability gate 验证项）。
 *
 * Meristem 是唯一授权与审计根：监督器不向 NetBird Management 注册，也不落任何凭证。
 */
import {
  transitionSidecarLifecycle,
  validateSidecarConfigPath,
  type SidecarCrash,
  type SidecarHealthProbe,
  type SidecarLifecycleState
} from './node-agent-sidecar.ts'

export type SpawnedSidecarProcess = {
  readonly pid: number
  readonly exited: Promise<number>
  kill(signal?: number): void
}

export type SidecarSpawn = (argv: string[], env: Record<string, string>) => SpawnedSidecarProcess

export type SidecarSupervisorOptions = {
  binaryPath: string
  configPath: string
  env?: NodeJS.ProcessEnv
  /** 注入式 spawn；生产默认 Bun.spawn，测试注入受控进程。 */
  spawn?: SidecarSpawn
  now?: () => Date
  /** 崩溃重启退避序列（毫秒）；耗尽后进入 gave_up。 */
  restartBackoffMs?: readonly number[]
  /** 优雅停止的 SIGTERM 等待窗口（毫秒），超时后 SIGKILL。 */
  stopGraceMs?: number
  /** 进程稳定运行超过该时长后才清零退避计数，避免崩溃循环永不放弃。 */
  minUptimeMs?: number
}

export type SidecarSupervisorState =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'running'; readonly pid: number; readonly startedAt: string }
  | { readonly kind: 'recovering'; readonly attempt: number; readonly startedAt: string }
  | { readonly kind: 'crashed'; readonly attempt: number; readonly crashedAt: string }
  | { readonly kind: 'gave_up'; readonly attempts: number; readonly crashedAt: string }

export type SidecarSupervisorStartResult =
  | { readonly ok: true; readonly pid: number; readonly alreadyRunning: boolean }
  | { readonly ok: false; readonly error: { code: string; message: string } }

const DEFAULT_RESTART_BACKOFF_MS = [1_000, 5_000, 15_000]
const DEFAULT_STOP_GRACE_MS = 5_000
const DEFAULT_MIN_UPTIME_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function defaultSpawn(argv: string[], env: Record<string, string>): SpawnedSidecarProcess {
  const proc = Bun.spawn(argv, {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore'
  })
  return {
    pid: proc.pid,
    exited: proc.exited,
    kill: signal => proc.kill(signal)
  }
}

export function createSidecarSupervisor(options: SidecarSupervisorOptions) {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const backoff = options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS
  const stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS
  const minUptimeMs = options.minUptimeMs ?? DEFAULT_MIN_UPTIME_MS
  const spawnProcess = options.spawn ?? defaultSpawn

  let lifecycle: SidecarLifecycleState = {
    kind: 'unhealthy',
    observedAt: now().toISOString(),
    finding: {
      code: 'sidecar.unhealthy',
      reason: 'process.not_running',
      message: 'sidecar health probe failed',
      detail: 'supervisor has not started the sidecar yet'
    }
  }
  let processRef: SpawnedSidecarProcess | null = null
  let currentRunStartedAt: number | null = null
  let supervisorState: SidecarSupervisorState = { kind: 'stopped' }
  let stopping = false
  let restartAttempt = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  function clientArgv(): string[] {
    const customArgs = env.MERISTEM_NETBIRD_CLIENT_ARGS
    if (customArgs && customArgs.trim().length > 0) {
      // 自定义参数里的 configPath 占位符替换，避免路径拼接引入 shell 元字符
      return [options.binaryPath, ...customArgs.trim().split(/\s+/)].map(arg =>
        arg.replaceAll('{config}', options.configPath)
      )
    }
    return [options.binaryPath, 'up', '--config', options.configPath]
  }

  function applyEvent(event: Parameters<typeof transitionSidecarLifecycle>[1]): void {
    lifecycle = transitionSidecarLifecycle(lifecycle, event)
  }

  function buildCrash(exitCode: number | null, signal: unknown): SidecarCrash {
    const crashedAt = now().toISOString()
    return {
      crashedAt,
      exitCode,
      signal: typeof signal === 'string' ? signal : null,
      stdout: '',
      stderr: '',
      message: `sidecar process exited with code ${exitCode ?? 'null'}`,
      // 日志负载只包含进程事实，绝不包含 argv 之外的凭证内容
      logPayload: { exitCode, signal: signal ?? null, crashedAt }
    }
  }

  async function handleExit(exitCode: number, signal?: unknown): Promise<void> {
    const uptimeMs = currentRunStartedAt === null ? 0 : now().getTime() - currentRunStartedAt
    processRef = null
    currentRunStartedAt = null
    if (stopping) {
      supervisorState = { kind: 'stopped' }
      return
    }
    // 只有进程真正稳定运行过才重置退避计数，崩溃循环必须最终走向 gave_up
    if (uptimeMs >= minUptimeMs) {
      restartAttempt = 0
    }
    const crash = buildCrash(exitCode, signal)
    applyEvent({ kind: 'sidecar_crashed', crash })
    supervisorState = { kind: 'crashed', attempt: restartAttempt, crashedAt: crash.crashedAt }
    scheduleRestart()
  }

  function scheduleRestart(): void {
    if (stopping) return
    if (restartAttempt >= backoff.length) {
      supervisorState = {
        kind: 'gave_up',
        attempts: restartAttempt,
        crashedAt: now().toISOString()
      }
      return
    }
    const delayMs = backoff[restartAttempt] ?? backoff[backoff.length - 1]!
    restartAttempt += 1
    restartTimer = setTimeout(() => {
      void restart()
    }, delayMs)
  }

  async function restart(): Promise<void> {
    if (stopping) return
    applyEvent({
      kind: 'sidecar_restart_started',
      startedAt: now().toISOString(),
      detail: `supervisor restart attempt ${restartAttempt}`
    })
    supervisorState = {
      kind: 'recovering',
      attempt: restartAttempt,
      startedAt: now().toISOString()
    }
    await spawnAndWatch()
    applyEvent({
      kind: 'sidecar_restarted',
      restartedAt: now().toISOString(),
      actor: 'node-agent-supervisor',
      detail: `sidecar restarted on attempt ${restartAttempt}`
    })
    supervisorState = {
      kind: 'running',
      pid: processRef?.pid ?? -1,
      startedAt: now().toISOString()
    }
  }

  async function spawnAndWatch(): Promise<number> {
    const spawned = spawnProcess(clientArgv(), {
      MERISTEM_SIDECAR_CONFIG_PATH: options.configPath
    })
    processRef = spawned
    currentRunStartedAt = now().getTime()
    void spawned.exited
      .then(exitCode => {
        // exited 之后才允许触发崩溃处理；kill 导致的退出由 stopping 分支吸收
        return handleExit(exitCode)
      })
      .catch(() => {
        // exited promise 本身不会 reject；兜底保持监督器状态一致
      })
    return spawned.pid
  }

  return {
    async start(): Promise<SidecarSupervisorStartResult> {
      const pathCheck = validateSidecarConfigPath(options.configPath)
      if (!pathCheck.ok) {
        return {
          ok: false,
          error: { code: pathCheck.error.reason, message: pathCheck.error.message }
        }
      }
      if (processRef) {
        return { ok: true, pid: processRef.pid, alreadyRunning: true }
      }
      stopping = false
      restartAttempt = 0
      let pid: number
      try {
        pid = await spawnAndWatch()
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'sidecar.spawn_failed',
            message: error instanceof Error ? error.message : 'failed to spawn sidecar process'
          }
        }
      }
      supervisorState = {
        kind: 'running',
        pid,
        startedAt: now().toISOString()
      }
      return { ok: true, pid, alreadyRunning: false }
    },

    async stop(): Promise<void> {
      stopping = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      const current = processRef
      if (!current) {
        supervisorState = { kind: 'stopped' }
        return
      }
      current.kill(15)
      const graceTimeout = sleep(stopGraceMs).then(() => 'grace_expired' as const)
      const exited = current.exited.then(() => 'exited' as const)
      const outcome = await Promise.race([exited, graceTimeout])
      if (outcome === 'grace_expired') {
        current.kill(9)
        // SIGKILL 之后仍给一个有界等待；进程若连 SIGKILL 都无法退出（僵尸/IO 卡死），
        // 监督器不能因为单个子进程永远卡在 stop()。
        const killTimeout = sleep(stopGraceMs).then(() => 'kill_timeout' as const)
        await Promise.race([current.exited.then(() => 'exited' as const), killTimeout])
      }
      processRef = null
      currentRunStartedAt = null
      supervisorState = { kind: 'stopped' }
    },

    state(): SidecarSupervisorState {
      return supervisorState
    },

    lifecycle(): SidecarLifecycleState {
      return lifecycle
    },

    /** 进程级健康探测：运行中 + 配置文件仍存在即为 alive，不探测凭证有效性。 */
    async healthProbe(): Promise<SidecarHealthProbe> {
      const probeAt = now().toISOString()
      if (supervisorState.kind !== 'running' || !processRef) {
        return {
          probeAt,
          ok: false,
          reason: 'process.not_running',
          detail: `sidecar supervisor state is ${supervisorState.kind}`
        }
      }
      const configExists = await Bun.file(options.configPath).exists()
      if (!configExists) {
        return {
          probeAt,
          ok: false,
          reason: 'probe.failed',
          detail: `sidecar config file missing at ${options.configPath}`
        }
      }
      return {
        probeAt,
        ok: true,
        detail: `sidecar process ${processRef.pid} running with config ${options.configPath}`
      }
    }
  }
}

export type SidecarSupervisor = ReturnType<typeof createSidecarSupervisor>
