import * as Schema from 'effect/Schema'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeStatus,
  NodeAgentRuntimeStatusKind,
  SecretFailureFromSchema,
  SecretRefFromSchema
} from '../../../packages/contracts/src/index.ts'
import { DeploymentConfigV02Schema } from '../../../packages/contracts/src/index.ts'
import {
  createSecretManagerFromConfigs,
  redactSecretRef,
  resolveNetBirdInfrastructureSecrets,
  resolveSidecarCredentials,
  type SecretManager
} from '../../../packages/secrets/src/index.ts'
import {
  DEFAULT_DEPLOYMENT_CONFIG_PATH,
  DEFAULT_SIDECAR_CONFIG_PATH,
  type NodeAgentLifecycleState,
  type SidecarLifecycleDependencies,
  type SidecarLifecycleInput
} from './node-agent-sidecar-lifecycle-types.ts'
import {
  reconcileNetBirdProcess,
  resolveNetBirdLaunchConfig,
  stopSidecarProcessIfRunning
} from './node-agent-sidecar-process-supervision.ts'

type RuntimeSidecarDesiredState = SidecarLifecycleInput['desired']
type SidecarRuntimeMap = SidecarLifecycleInput['runtimeMap']
type SidecarProcessState = NonNullable<SidecarLifecycleInput['currentProcess']>

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

/** 根据节点部署配置构造 sidecar 所需的 SecretProvider 管理器。 */
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
  if (!infra.ok) return { ok: false, error: infra.error, source: 'infrastructure' }
  const sidecar = await resolveSidecarCredentials(manager, {
    authTokenRef: desired.sidecarCredentialRef
  })
  if (!sidecar.ok) return { ok: false, error: sidecar.error, source: 'sidecar' }
  return { ok: true, value: { infra: infra.value, sidecar: sidecar.value } }
}

function dependencyState(value: string | undefined): 'ready' | 'unavailable' {
  return value && value.trim().length > 0 ? 'ready' : 'unavailable'
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
    dependencies: { signal: 'unavailable', relay: 'unavailable', stun: 'unavailable' },
    degradedReasons: input.degradedReasons ?? [],
    credentialRef: redactedCredentialRef(input.desired.sidecarCredentialRef)
  }
}

function secretFailureReason(
  source: 'sidecar' | 'infrastructure',
  error: SecretFailureFromSchema
): NodeAgentRuntimeStatus['degradedReasons'][number] {
  const reasonByFailure: Record<
    SecretFailureFromSchema['code'],
    NodeAgentRuntimeStatus['degradedReasons'][number]['code']
  > = {
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

/**
 * 统一解析期望态、secret 与本地配置；任何 secret 失败均在写入配置或启动进程前 fail-closed。
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
  const launch = resolveNetBirdLaunchConfig({
    env: runtimeEnv,
    deploymentConfig: config,
    setupKey: resolved.value.sidecar.authToken
  })
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

  // 进程启停跟随期望态：start 族拉起监督器，stop/drain 优雅回收；失败降级不伪装成功。
  const supervisor = deps.supervisor
  if (supervisor) {
    if (input.desired.desiredState === 'stop' || input.desired.desiredState === 'drain') {
      await supervisor.stop()
    } else {
      const started = await supervisor.start()
      if (!started.ok) {
        degradedReasons.push({
          code: 'netbird.start_failed',
          message: 'netbird sidecar process failed to start',
          detail: started.error.code
        })
      }
    }
  }

  const kind: NodeAgentRuntimeStatusKind =
    input.desired.desiredState === 'stop' || input.desired.desiredState === 'drain'
      ? 'stopped'
      : degradedReasons.length > 0 || input.desired.healthStatus === 'degraded'
        ? 'degraded'
        : processResult.process.observedHealth === 'healthy' ||
            input.desired.healthStatus === 'healthy'
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

/** break-glass 或 profile disable 时仅回收 sidecar，不删除宿主私钥。 */
export async function stopSidecarLifecycle(input: {
  desiredState: RuntimeSidecarDesiredState['desiredState']
  observedAt: string
  correlationId: string
  reason: 'break_glass_stop' | 'profile_disabled'
  credentialRef?: SecretRefFromSchema
  process?: SidecarProcessState
  deps?: SidecarLifecycleDependencies
}): Promise<NodeAgentLifecycleState> {
  await stopSidecarProcessIfRunning(input.deps ?? {}, input.process)
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
      dependencies: { signal: 'unavailable', relay: 'unavailable', stun: 'unavailable' },
      degradedReasons: [{ code: input.reason, message: input.reason.replaceAll('_', ' ') }],
      ...(input.credentialRef ? { credentialRef: redactedCredentialRef(input.credentialRef) } : {})
    },
    process: {}
  }
}
