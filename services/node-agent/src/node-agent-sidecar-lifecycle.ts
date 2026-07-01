import * as Schema from 'effect/Schema'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentDegradedReasonCode,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus,
  NodeAgentRuntimeStatusKind,
  SecretFailureFromSchema,
  SecretRefFromSchema
} from '../../../packages/contracts/src/index.ts'
import {
  evaluateSidecarState,
  validateSidecarConfigPath,
  type SidecarHealthProbe,
  type SidecarUnhealthyReason
} from './node-agent-sidecar.ts'
import {
  createSecretManagerFromConfigs,
  redactSecretRef,
  resolveNetBirdInfrastructureSecrets,
  resolveSidecarCredentials,
  type SecretManager
} from '../../../packages/secrets/src/index.ts'
import { DeploymentConfigV02Schema } from '../../../packages/contracts/src/index.ts'

export const DEFAULT_DEPLOYMENT_CONFIG_PATH = '/etc/meristem/node-agent/deployment-v02.json'
export const DEFAULT_SIDECAR_CONFIG_PATH = '/run/meristem/netbird/sidecar.json'

type RuntimeSidecarDesiredState = NodeAgentRuntimeDesiredSidecar

type SidecarRuntimeMap = {
  networkId: string
  mapVersion: number
}

type SidecarProcessState = {
  processRef?: string
  sidecarConfigPath?: string
  configHash?: string
  processPid?: number
  processStartedAt?: string
  lastProbeAt?: string
  observedHealth?: 'healthy' | 'degraded' | 'unknown'
  degradedReason?: NodeAgentRuntimeStatus['degradedReasons'][number]
}

export type NodeAgentLifecycleState = {
  runtimeStatus: NodeAgentRuntimeStatus
  process: SidecarProcessState
}

export type SidecarLifecycleInput = {
  nodeId: string
  correlationId: string
  observedAt: string
  desired: RuntimeSidecarDesiredState
  runtimeMap: SidecarRuntimeMap
  currentProcess?: SidecarProcessState
}

export type SidecarLifecycleDependencies = {
  env?: NodeJS.ProcessEnv
  secretManager?: SecretManager
  deploymentConfig?: DeploymentConfigV02FromSchema
  readTextFile?: (path: string) => Promise<string>
  writeTextFile?: (path: string, contents: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
  spawnProcess?: (command: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ pid: number }>
  runCommand?: (command: readonly string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>
  killProcess?: (pid: number, signal: NodeJS.Signals) => Promise<void>
  isProcessRunning?: (pid: number) => boolean
}

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type NetBirdLaunchConfig = {
  binaryPath: string
  managementUrl: string
  setupKey: string
}

type ResolvedSecrets = {
  infra: {
    signalCredential?: string
    relayCredential?: string
    stunCredential?: string
  }
  sidecar: {
    authToken?: string
    configSecret?: string
  }
}

const PROCESS_EXIT_POLL_MS = 25
const PROCESS_GRACEFUL_STOP_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function decodeDeploymentConfig(text: string): DeploymentConfigV02FromSchema {
  return Schema.decodeUnknownSync(DeploymentConfigV02Schema)(JSON.parse(text))
}

async function defaultReadTextFile(path: string): Promise<string> {
  return Bun.file(path).text()
}

async function defaultWriteTextFile(path: string, contents: string): Promise<void> {
  await Bun.write(path, contents)
}

async function defaultMkdir(path: string): Promise<void> {
  await Bun.$`mkdir -p ${path}`.quiet()
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

async function defaultKillProcess(pid: number, signal: NodeJS.Signals): Promise<void> {
  try {
    process.kill(pid, signal)
  } catch {
    // 进程已经消失时，停止语义已经满足。
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

function deploymentConfigPath(env: NodeJS.ProcessEnv): string {
  return env.MERISTEM_V02_DEPLOYMENT_CONFIG ?? DEFAULT_DEPLOYMENT_CONFIG_PATH
}

async function loadDeploymentConfig(
  deps: SidecarLifecycleDependencies
): Promise<DeploymentConfigV02FromSchema> {
  if (deps.deploymentConfig) return deps.deploymentConfig
  const env = deps.env ?? process.env
  const readTextFile = deps.readTextFile ?? defaultReadTextFile
  return decodeDeploymentConfig(await readTextFile(deploymentConfigPath(env)))
}

function createSecretManager(
  config: DeploymentConfigV02FromSchema,
  env: NodeJS.ProcessEnv
): SecretManager {
  return createSecretManagerFromConfigs({
    providers: [
      {
        name: config.secretProvider.providerName,
        config: config.secretProvider.namedProvider.config
      }
    ],
    ...(config.secretProvider.namedProvider.cache
      ? { cache: config.secretProvider.namedProvider.cache }
      : {}),
    env
  })
}

export function createNodeAgentSecretManager(
  config: DeploymentConfigV02FromSchema,
  env: NodeJS.ProcessEnv = process.env
): SecretManager {
  return createSecretManager(config, env)
}

function redactedCredentialRef(ref: SecretRefFromSchema) {
  const redacted = redactSecretRef(ref)
  return redacted.version === undefined ? redacted : { ...redacted, version: redacted.version }
}

function toInfraBindings(
  config: DeploymentConfigV02FromSchema,
  desired: RuntimeSidecarDesiredState
) {
  return {
    signalCredentialRef: {
      provider: config.secretProvider.providerName,
      keyPath: desired.signalConfigRef.configRef
    },
    relayCredentialRef: {
      provider: config.secretProvider.providerName,
      keyPath: desired.relayConfigRef.configRef
    },
    stunCredentialRef: {
      provider: config.secretProvider.providerName,
      keyPath: desired.stunConfigRef.configRef
    }
  }
}

async function resolveSecrets(
  manager: SecretManager,
  config: DeploymentConfigV02FromSchema,
  desired: RuntimeSidecarDesiredState
): Promise<
  | { ok: true; value: ResolvedSecrets }
  | { ok: false; error: SecretFailureFromSchema; source: 'sidecar' | 'infrastructure' }
> {
  const infra = await resolveNetBirdInfrastructureSecrets(manager, toInfraBindings(config, desired))
  if (!infra.ok) {
    return { ok: false, error: infra.error, source: 'infrastructure' }
  }

  const sidecar = await resolveSidecarCredentials(manager, {
    authTokenRef: desired.sidecarCredentialRef
  })
  if (!sidecar.ok) {
    return { ok: false, error: sidecar.error, source: 'sidecar' }
  }

  return {
    ok: true,
    value: {
      infra: infra.value,
      sidecar: sidecar.value
    }
  }
}

function dependencyState(value: string | undefined): 'ready' | 'unavailable' {
  return value && value.trim().length > 0 ? 'ready' : 'unavailable'
}

function degradedReason(
  code: NodeAgentDegradedReasonCode,
  message: string,
  detail?: string
): NodeAgentRuntimeStatus['degradedReasons'][number] {
  return detail ? { code, message, detail } : { code, message }
}

function buildStatus(input: {
  kind: NodeAgentRuntimeStatusKind
  observedAt: string
  correlationId: string
  desired: RuntimeSidecarDesiredState
  process?: SidecarProcessState
  degradedReasons?: NodeAgentRuntimeStatus['degradedReasons']
}): NodeAgentRuntimeStatus {
  return {
    kind: input.kind,
    desiredState: input.desired.desiredState,
    credentialStatus: input.desired.credentialStatus,
    healthStatus: input.desired.healthStatus,
    ...(input.process?.configHash ? { configHash: input.process.configHash } : {}),
    ...(input.process?.sidecarConfigPath
      ? { sidecarConfigPath: input.process.sidecarConfigPath }
      : {}),
    ...(input.process?.processRef ? { processRef: input.process.processRef } : {}),
    ...(input.process?.processPid ? { processPid: input.process.processPid } : {}),
    ...(input.process?.processStartedAt
      ? { processStartedAt: input.process.processStartedAt }
      : {}),
    ...(input.process?.lastProbeAt ? { lastProbeAt: input.process.lastProbeAt } : {}),
    ...(input.process?.observedHealth ? { observedHealth: input.process.observedHealth } : {}),
    ...(input.process?.degradedReason ? { degradedReason: input.process.degradedReason } : {}),
    correlationId: input.correlationId,
    observedAt: input.observedAt,
    dependencies: {
      signal: 'unavailable',
      relay: 'unavailable',
      stun: 'unavailable'
    },
    degradedReasons: input.degradedReasons ?? [],
    credentialRef: redactedCredentialRef(input.desired.sidecarCredentialRef)
  }
}

function validateExecutablePath(path: string): { ok: true; value: string } | { ok: false; error: string } {
  if (path.trim().length === 0) return { ok: false, error: 'binary path is empty' }
  const validated = validateSidecarConfigPath(path)
  return validated.ok ? { ok: true, value: validated.value } : { ok: false, error: validated.error.reason }
}

function netbirdBinaryPath(env: NodeJS.ProcessEnv): string {
  return env.MERISTEM_NETBIRD_BINARY_PATH ?? 'netbird'
}

function resolveLaunchConfig(input: {
  env: NodeJS.ProcessEnv
  deploymentConfig: DeploymentConfigV02FromSchema
  secrets: ResolvedSecrets
}): { ok: true; value: NetBirdLaunchConfig } | { ok: false; reason: NodeAgentRuntimeStatus['degradedReasons'][number] } {
  const binary = validateExecutablePath(netbirdBinaryPath(input.env))
  if (!binary.ok) {
    return {
      ok: false,
      reason: degradedReason('netbird.binary.invalid', 'NetBird binary path is invalid', binary.error)
    }
  }

  const setupKey = input.secrets.sidecar.authToken
  if (!setupKey || setupKey.trim().length === 0) {
    return {
      ok: false,
      reason: degradedReason('netbird.setup_key.missing', 'NetBird setup key is unavailable')
    }
  }

  return {
    ok: true,
    value: {
      binaryPath: binary.value,
      managementUrl: input.env.MERISTEM_NETBIRD_MANAGEMENT_URL ?? input.deploymentConfig.netbird.signalEndpoint,
      setupKey
    }
  }
}

function processIsRunning(
  deps: SidecarLifecycleDependencies,
  state: SidecarProcessState | undefined
): boolean {
  if (!state?.processPid) return false
  return (deps.isProcessRunning ?? defaultIsProcessRunning)(state.processPid)
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

async function stopProcessIfRunning(
  deps: SidecarLifecycleDependencies,
  state: SidecarProcessState | undefined
): Promise<void> {
  if (!state?.processPid || !processIsRunning(deps, state)) return
  const kill = deps.killProcess ?? defaultKillProcess
  await kill(state.processPid, 'SIGTERM')
  const stopped = await waitForProcessExit(deps, state.processPid, PROCESS_GRACEFUL_STOP_MS)
  if (!stopped) {
    await kill(state.processPid, 'SIGKILL')
    await waitForProcessExit(deps, state.processPid, PROCESS_GRACEFUL_STOP_MS)
  }
}

function secretFailureReason(
  source: 'sidecar' | 'infrastructure',
  error: SecretFailureFromSchema
): NodeAgentRuntimeStatus['degradedReasons'][number] {
  const reasonByFailure: Record<SecretFailureFromSchema['code'], NodeAgentRuntimeStatus['degradedReasons'][number]['code']> = {
    secret_missing: 'secret.missing',
    permission_denied: 'secret.denied',
    provider_unavailable: 'secret.provider_unavailable',
    unsupported_backend: 'secret.unsupported_backend',
    stale_secret: 'secret.stale'
  }
  return {
    code: reasonByFailure[error.code],
    message: `${source} secret resolution failed`,
    detail: error.code
  }
}

function withDependencies(
  status: NodeAgentRuntimeStatus,
  secrets: ResolvedSecrets
): NodeAgentRuntimeStatus {
  return {
    ...status,
    dependencies: {
      signal: dependencyState(secrets.infra.signalCredential),
      relay: dependencyState(secrets.infra.relayCredential),
      stun: dependencyState(secrets.infra.stunCredential)
    }
  }
}

function deriveDegradedReasons(
  desired: RuntimeSidecarDesiredState,
  secrets: ResolvedSecrets
): NodeAgentRuntimeStatus['degradedReasons'] {
  const reasons: NodeAgentRuntimeStatus['degradedReasons'] = []
  if (desired.credentialStatus === 'expired') {
    reasons.push({ code: 'expired_credentials', message: 'sidecar credential is expired' })
  }
  if (dependencyState(secrets.infra.signalCredential) === 'unavailable') {
    reasons.push({ code: 'missing_signal', message: 'Signal credential is unavailable' })
  }
  if (dependencyState(secrets.infra.relayCredential) === 'unavailable') {
    reasons.push({ code: 'missing_relay', message: 'Relay credential is unavailable' })
  }
  if (dependencyState(secrets.infra.stunCredential) === 'unavailable') {
    reasons.push({ code: 'missing_stun', message: 'STUN credential is unavailable' })
  }
  return reasons
}

async function writeLocalSidecarConfig(
  deps: SidecarLifecycleDependencies,
  desired: RuntimeSidecarDesiredState,
  runtimeMap: SidecarRuntimeMap,
  processRef: string,
  correlationId: string
): Promise<SidecarProcessState> {
  const env = deps.env ?? process.env
  const sidecarConfigPath =
    env.MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH ?? DEFAULT_SIDECAR_CONFIG_PATH
  const writeTextFile = deps.writeTextFile ?? defaultWriteTextFile
  const mkdir = deps.mkdir ?? defaultMkdir
  const directory = sidecarConfigPath.replace(/\/[^/]+$/, '')
  await mkdir(directory)
  const config = {
    networkId: runtimeMap.networkId,
    mapVersion: runtimeMap.mapVersion,
    desiredState: desired.desiredState,
    signalConfigRef: desired.signalConfigRef,
    relayConfigRef: desired.relayConfigRef,
    stunConfigRef: desired.stunConfigRef,
    correlationId
  }
  await writeTextFile(sidecarConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  return {
    processRef,
    sidecarConfigPath,
    configHash: desired.configHash ?? `sidecar:${runtimeMap.networkId}:${runtimeMap.mapVersion}`
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

async function spawnNetBirdProcess(input: {
  deps: SidecarLifecycleDependencies
  launch: NetBirdLaunchConfig
  process: SidecarProcessState
  env: NodeJS.ProcessEnv
  observedAt: string
}): Promise<{ ok: true; value: SidecarProcessState } | { ok: false; reason: NodeAgentRuntimeStatus['degradedReasons'][number]; process: SidecarProcessState }> {
  const spawn = input.deps.spawnProcess ?? defaultSpawnProcess
  try {
    const started = await spawn(startCommand(input.launch, input.process.sidecarConfigPath ?? DEFAULT_SIDECAR_CONFIG_PATH), {
      ...input.env,
      MERISTEM_NETBIRD_CONFIG_HASH: input.process.configHash ?? ''
    })
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

function probeReason(result: CommandResult): SidecarUnhealthyReason {
  if (result.exitCode !== 0) return 'probe.failed'
  const normalized = `${result.stdout}\n${result.stderr}`.toLowerCase()
  return normalized.includes('timeout') ? 'probe.timeout' : 'probe.failed'
}

function parseProbeResult(result: CommandResult, probeAt: string): SidecarHealthProbe {
  const detail = (result.stdout.trim() || result.stderr.trim() || `netbird status exited ${result.exitCode}`).slice(0, 400)
  if (result.exitCode !== 0) {
    return { ok: false, probeAt, reason: probeReason(result), detail }
  }

  const normalized = result.stdout.toLowerCase()
  if (normalized.includes('connected') || normalized.includes('running') || normalized.includes('healthy')) {
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
}): Promise<{ process: SidecarProcessState; reason?: NodeAgentRuntimeStatus['degradedReasons'][number] }> {
  if (!processIsRunning(input.deps, input.process)) {
    const reason = degradedReason('netbird.process.not_running', 'NetBird client process is not running')
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
  return {
    process: {
      ...restProcess,
      lastProbeAt: input.observedAt,
      observedHealth: 'healthy'
    }
  }
}

async function reconcileNetBirdProcess(input: {
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
  const shouldRun = input.desired.desiredState === 'start' || input.desired.desiredState === 'configure'

  if (!shouldRun) {
    await stopProcessIfRunning(input.deps, input.currentProcess)
    return { process: input.nextProcess, reasons }
  }

  if (hasDrift) {
    reasons.push(degradedReason('netbird.config_drift_repaired', 'NetBird config drift was detected and repaired'))
    await stopProcessIfRunning(input.deps, input.currentProcess)
  } else if (!running && input.currentProcess?.processPid) {
    reasons.push(degradedReason('netbird.process_restarted', 'NetBird client stopped unexpectedly and was restarted'))
  }

  const processToProbe = hasDrift || !running
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

/**
 * 统一在 node-agent 内部解析 sidecar 期望态、secret 和本地配置写入。
 */
export async function applySidecarDesiredState(
  input: SidecarLifecycleInput,
  deps: SidecarLifecycleDependencies = {}
): Promise<NodeAgentLifecycleState> {
  const runtimeEnv = deps.env ?? process.env
  const config = await loadDeploymentConfig({ ...deps, env: runtimeEnv })
  const secrets = deps.secretManager ?? createSecretManager(config, runtimeEnv)
  const resolved = await resolveSecrets(secrets, config, input.desired)

  if (!resolved.ok) {
    return {
      runtimeStatus: buildStatus({
        kind: 'degraded',
        observedAt: input.observedAt,
        correlationId: input.correlationId,
        desired: input.desired,
        degradedReasons: [secretFailureReason(resolved.source, resolved.error)]
      }),
      process: {}
    }
  }

  const degradedReasons = deriveDegradedReasons(input.desired, resolved.value)
  const processRef = `sidecar:${input.nodeId}:${input.runtimeMap.mapVersion}`
  const nextProcess = await writeLocalSidecarConfig(
    deps,
    input.desired,
    input.runtimeMap,
    processRef,
    input.correlationId
  )

  const launch = resolveLaunchConfig({ env: runtimeEnv, deploymentConfig: config, secrets: resolved.value })
  if (!launch.ok) degradedReasons.push(launch.reason)

  const processResult = launch.ok
    ? await reconcileNetBirdProcess({
        deps,
        env: runtimeEnv,
        desired: input.desired,
        observedAt: input.observedAt,
        currentProcess: input.currentProcess,
        nextProcess,
        launch: launch.value
      })
    : { process: nextProcess, reasons: [] }
  degradedReasons.push(...processResult.reasons)

  const kind: NodeAgentRuntimeStatusKind =
    input.desired.desiredState === 'stop' || input.desired.desiredState === 'drain'
      ? 'stopped'
      : degradedReasons.length > 0 || input.desired.healthStatus === 'degraded'
        ? 'degraded'
        : processResult.process.observedHealth === 'healthy' || input.desired.healthStatus === 'healthy'
          ? 'healthy'
          : 'starting'

  return {
    runtimeStatus: withDependencies(
      buildStatus({
        kind,
        observedAt: input.observedAt,
        correlationId: input.correlationId,
        desired: input.desired,
        process: processResult.process,
        degradedReasons
      }),
      resolved.value
    ),
    process: processResult.process
  }
}

/**
 * break-glass / profile disable 时只回收 sidecar 运行态，不删除宿主私钥。
 */
export async function stopSidecarLifecycle(input: {
  desiredState: RuntimeSidecarDesiredState['desiredState']
  observedAt: string
  correlationId: string
  reason: 'break_glass_stop' | 'profile_disabled'
  credentialRef?: SecretRefFromSchema
  process?: SidecarProcessState
  deps?: SidecarLifecycleDependencies
}): Promise<NodeAgentLifecycleState> {
  await stopProcessIfRunning(input.deps ?? {}, input.process)
  return {
    runtimeStatus: {
      kind: 'stopped',
      desiredState: input.desiredState,
      credentialStatus: 'ready',
      healthStatus: 'unknown',
      ...(input.process?.configHash ? { configHash: input.process.configHash } : {}),
      ...(input.process?.sidecarConfigPath
        ? { sidecarConfigPath: input.process.sidecarConfigPath }
        : {}),
      ...(input.process?.processRef ? { processRef: input.process.processRef } : {}),
      ...(input.process?.processPid ? { processPid: input.process.processPid } : {}),
      ...(input.process?.processStartedAt
        ? { processStartedAt: input.process.processStartedAt }
        : {}),
      ...(input.process?.lastProbeAt ? { lastProbeAt: input.process.lastProbeAt } : {}),
      observedHealth: 'unknown',
      correlationId: input.correlationId,
      observedAt: input.observedAt,
      dependencies: {
        signal: 'unavailable',
        relay: 'unavailable',
        stun: 'unavailable'
      },
      degradedReasons: [{ code: input.reason, message: input.reason.replaceAll('_', ' ') }],
      ...(input.credentialRef ? { credentialRef: redactedCredentialRef(input.credentialRef) } : {})
    },
    process: {}
  }
}
