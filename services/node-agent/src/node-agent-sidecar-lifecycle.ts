import * as Schema from 'effect/Schema'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus,
  NodeAgentRuntimeStatusKind,
  SecretFailureFromSchema,
  SecretRefFromSchema
} from '../../../packages/contracts/src/index.ts'
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
}

export type SidecarLifecycleDependencies = {
  env?: NodeJS.ProcessEnv
  readTextFile?: (path: string) => Promise<string>
  writeTextFile?: (path: string, contents: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
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

function redactedCredentialRef(ref: SecretRefFromSchema) {
  const redacted = redactSecretRef(ref)
  return redacted.version === undefined ? redacted : { ...redacted, version: redacted.version }
}

function toInfraBindings(config: DeploymentConfigV02FromSchema, desired: RuntimeSidecarDesiredState) {
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
    ...(input.process?.sidecarConfigPath ? { sidecarConfigPath: input.process.sidecarConfigPath } : {}),
    ...(input.process?.processRef ? { processRef: input.process.processRef } : {}),
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
  const sidecarConfigPath = env.MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH ?? DEFAULT_SIDECAR_CONFIG_PATH
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
 * 统一在 node-agent 内部解析 sidecar 期望态、secret 和本地配置写入。
 */
export async function applySidecarDesiredState(
  input: SidecarLifecycleInput,
  deps: SidecarLifecycleDependencies = {}
): Promise<NodeAgentLifecycleState> {
  const runtimeEnv = deps.env ?? process.env
  const config = await loadDeploymentConfig({ ...deps, env: runtimeEnv })
  const secrets = createSecretManager(config, runtimeEnv)
  const resolved = await resolveSecrets(secrets, config, input.desired)

  if (!resolved.ok) {
    return {
      runtimeStatus: buildStatus({
        kind: 'degraded',
        observedAt: input.observedAt,
        correlationId: input.correlationId,
        desired: input.desired,
        degradedReasons: [
          {
            code: 'secret_resolution_failed',
            message: `${resolved.source} secret resolution failed`,
            detail: resolved.error.code
          }
        ]
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

  const kind: NodeAgentRuntimeStatusKind =
    input.desired.desiredState === 'stop' || input.desired.desiredState === 'drain'
      ? 'stopped'
      : degradedReasons.length > 0 || input.desired.healthStatus === 'degraded'
        ? 'degraded'
        : input.desired.healthStatus === 'healthy'
          ? 'healthy'
          : 'starting'

  return {
    runtimeStatus: withDependencies(
      buildStatus({
        kind,
        observedAt: input.observedAt,
        correlationId: input.correlationId,
        desired: input.desired,
        process: nextProcess,
        degradedReasons
      }),
      resolved.value
    ),
    process: nextProcess
  }
}

/**
 * break-glass / profile disable 时只回收 sidecar 运行态，不删除宿主私钥。
 */
export function stopSidecarLifecycle(input: {
  desiredState: RuntimeSidecarDesiredState['desiredState']
  observedAt: string
  correlationId: string
  reason: 'break_glass_stop' | 'profile_disabled'
  credentialRef?: SecretRefFromSchema
  process?: SidecarProcessState
}): NodeAgentLifecycleState {
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
    process: input.process ?? {}
  }
}
