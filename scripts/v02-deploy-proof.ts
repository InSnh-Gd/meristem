/**
 * v02-deploy-proof.ts — v0.2 deployment proof command。
 *
 * 该 proof 不再只检查前置条件；它会拉起或复用真实本地服务，
 * 并输出可机读 JSON 证据，而不是把失败折叠成泛化异常。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createRuntimeSecretManager,
  resolveCoreOidcStartupSecrets
} from '../apps/core/src/adapters.ts'
import { mintLocalToken } from '../packages/auth/src/index.ts'
import {
  loadRuntimeDeploymentConfig,
  RUNTIME_DEPLOYMENT_CONFIG_ENV,
  type RuntimeDeploymentConfig
} from '../packages/config/src/index.ts'
import type { DeploymentConfigV02FromSchema } from '../packages/contracts/src/index.ts'
import { createSqlClient } from '../packages/db/src/client.ts'
import { connectToNats } from '../packages/nats-rpc/src/index.ts'
import { resolveDeploymentSecretBindings } from '../packages/secrets/src/index.ts'
import {
  buildKeycloakDeploymentConfig,
  ensureKeycloakDevRealm,
  type KeycloakDevRealmResult,
  type KeycloakRealmState,
  keycloakClientSecretEnvVar,
  mintKeycloakTokenForActor
} from './keycloak-dev-realm.ts'
import { prepareInfra, prepareWorkspace, rootDir } from './local-stack-runtime.ts'

export type DeployTarget = 'nixos' | 'oci'
export type DeployAuthMode = 'oidc' | 'local-dev'
export type DeployVerdict = 'pass' | 'prerequisite-missing' | 'failure'

type SuccessResult = {
  readonly status: 'success'
  readonly step: string
  readonly detail: string
}

type PrerequisiteMissingResult = {
  readonly status: 'prerequisite-missing'
  readonly step: string
  readonly code: string
  readonly message: string
  readonly detail?: string
}

type FailureResult = {
  readonly status: 'failure'
  readonly step: string
  readonly code: string
  readonly message: string
  readonly detail?: string
}

export type DeployProofResult = SuccessResult | PrerequisiteMissingResult | FailureResult

type ServiceEvidence = {
  readonly status: 'ready' | 'reused' | 'started' | 'restarted' | 'prerequisite-missing' | 'failure'
  readonly detail: string
  readonly endpoint?: string
  readonly logFile?: string
  readonly pid?: number
}

type ManagedServiceName =
  | 'postgres'
  | 'nats'
  | 'keycloak'
  | 'm-eventbus'
  | 'm-policy'
  | 'm-log'
  | 'm-net'
  | 'm-task'
  | 'm-extension'
  | 'core'
  | 'm-ui-bff'
  | 'node-agent'

type ManagedServiceState = {
  readonly logFile: string
  readonly pid: number
  readonly startedAt: string
}

type StoredState = {
  readonly services: Partial<Record<ManagedServiceName, ManagedServiceState>>
}

type ManagedServiceDefinition = {
  readonly name: Exclude<ManagedServiceName, 'postgres' | 'nats' | 'keycloak' | 'node-agent'>
  readonly command: readonly string[]
  readonly readinessKey: keyof RuntimeDeploymentConfig['raw']['readiness']
}

type JoinTicketResult =
  | { readonly ok: true; readonly ticket: string }
  | { readonly ok: false; readonly result: FailureResult }

type ProofPaths = {
  readonly deploymentConfigPath: string
  readonly logDir: string
  readonly runtimeStatePath: string
  readonly stateFile: string
  readonly workspaceDir: string
}

type PreparedContext = {
  readonly authMode: DeployAuthMode
  readonly keycloakRealm: KeycloakRealmState
  readonly paths: ProofPaths
  readonly runtimeConfig: RuntimeDeploymentConfig
  readonly sharedEnv: Record<string, string>
  readonly target: DeployTarget
}

export type DeployProofReport = {
  readonly auth: {
    readonly mode: DeployAuthMode
    readonly keycloakDiscoveryUrl: string
    readonly keycloakJwksUrl: string
    readonly provider: RuntimeDeploymentConfig['auth']['provider']
  }
  readonly deploymentConfigPath: string
  readonly proof: string
  readonly results: readonly DeployProofResult[]
  readonly secretProvider: {
    readonly backend: RuntimeDeploymentConfig['secretProvider']['backend']
    readonly providerName: string
  }
  readonly services: Partial<Record<ManagedServiceName, ServiceEvidence>>
  readonly target: DeployTarget
  readonly verdict: DeployVerdict
}

export type DeployProofDeps = {
  ensureKeycloakDevRealm: () => Promise<KeycloakDevRealmResult>
  hasCapNetAdmin: () => boolean
  isPidAlive: (pid: number) => boolean
  killPid: (pid: number) => void
  loadRuntimeDeploymentConfig: (
    env: NodeJS.ProcessEnv,
    readTextFile: (path: string) => Promise<string>
  ) => ReturnType<typeof loadRuntimeDeploymentConfig>
  now: () => Date
  postgresReady: (databaseUrl: string) => Promise<boolean>
  prepareInfra: () => Promise<void>
  prepareWorkspace: () => Promise<void>
  probeReadyEndpoint: (url: string, internalToken?: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  runVersionCommand: (command: readonly string[]) => {
    readonly exitCode: number
    readonly stderr: string
    readonly stdout: string
  }
  sleep: (ms: number) => Promise<void>
  startDetached: (
    command: readonly string[],
    logFile: string,
    env: Record<string, string>
  ) => number
  writeTextFile: (path: string, contents: string) => Promise<void>
  natsReady: (natsUrl: string) => Promise<boolean>
}

const joinHealthUrl = 'https://127.0.0.1:8443/join/v0/health'
const managedServices: readonly ManagedServiceDefinition[] = [
  {
    name: 'm-eventbus',
    command: ['bun', 'run', 'services/m-eventbus/src/index.ts'],
    readinessKey: 'eventbus'
  },
  {
    name: 'm-policy',
    command: ['bun', 'run', 'services/m-policy/src/index.ts'],
    readinessKey: 'policy'
  },
  { name: 'm-log', command: ['bun', 'run', 'services/m-log/src/index.ts'], readinessKey: 'log' },
  { name: 'm-net', command: ['bun', 'run', 'services/m-net/src/index.ts'], readinessKey: 'mnet' },
  { name: 'm-task', command: ['bun', 'run', 'services/m-task/src/index.ts'], readinessKey: 'task' },
  {
    name: 'm-extension',
    command: ['bun', 'run', 'services/m-extension/src/index.ts'],
    readinessKey: 'extension'
  },
  { name: 'core', command: ['bun', 'run', 'apps/core/src/index.ts'], readinessKey: 'core' },
  {
    name: 'm-ui-bff',
    command: ['bun', 'run', 'services/m-ui-bff/src/index.ts'],
    readinessKey: 'uiBff'
  }
] as const

function success(step: string, detail: string): SuccessResult {
  return { status: 'success', step, detail }
}

function prerequisiteMissing(
  step: string,
  code: string,
  message: string,
  detail?: string
): PrerequisiteMissingResult {
  return { status: 'prerequisite-missing', step, code, message, ...(detail ? { detail } : {}) }
}

function failure(step: string, code: string, message: string, detail?: string): FailureResult {
  return { status: 'failure', step, code, message, ...(detail ? { detail } : {}) }
}

function targetFromArgv(argv: readonly string[]): DeployTarget | null {
  const raw =
    argv.find(argument => argument.startsWith('--target='))?.split('=')[1] ??
    process.env.DEPLOY_TARGET ??
    'nixos'
  return raw === 'nixos' || raw === 'oci' ? raw : null
}

function authModeFromArgv(argv: readonly string[]): DeployAuthMode | null {
  const raw =
    argv.find(argument => argument.startsWith('--auth='))?.split('=')[1] ??
    process.env.MERISTEM_DEPLOY_PROOF_AUTH_MODE ??
    'oidc'
  return raw === 'oidc' || raw === 'local-dev' ? raw : null
}

function proofPaths(target: DeployTarget, authMode: DeployAuthMode): ProofPaths {
  const workspaceDir = join(rootDir, '.local', 'v02-deploy-proof')
  return {
    workspaceDir,
    logDir: join(workspaceDir, 'logs'),
    stateFile: join(workspaceDir, 'state.json'),
    deploymentConfigPath: join(workspaceDir, `deployment-${target}-${authMode}.json`),
    runtimeStatePath: join(workspaceDir, `node-agent-runtime-${target}-${authMode}.json`)
  }
}

function normalizeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  )
}

function _requiredEnv(env: Record<string, string>, key: string): string {
  const value = env[key]
  if (!value) throw new Error(`${key} is required`)
  return value
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function tailLogFile(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    return lines.slice(-20).join('\n')
  } catch {
    return 'log file not readable'
  }
}

function loadStoredState(path: string): StoredState {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredState
  } catch {
    return { services: {} }
  }
}

function saveStoredState(path: string, state: StoredState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * 真实 proof 仍然要显式记录本地进程状态，避免重复启动造成端口冲突或 session 抖动。
 */
function updateStoredService(
  path: string,
  name: ManagedServiceName,
  next: ManagedServiceState | null
): StoredState {
  const current = loadStoredState(path)
  const services = { ...current.services }
  if (next) {
    services[name] = next
  } else {
    delete services[name]
  }
  const updated = { services }
  saveStoredState(path, updated)
  return updated
}

function buildDeploymentConfig(
  realm: KeycloakRealmState,
  target: DeployTarget,
  authMode: DeployAuthMode,
  runtimeStatePath: string
): DeploymentConfigV02FromSchema {
  const base = buildKeycloakDeploymentConfig(realm)
  return {
    ...base,
    track: target,
    oidc:
      authMode === 'oidc'
        ? base.oidc
        : {
            provider: 'local-dev'
          },
    readiness: {
      ...base.readiness,
      nodeAgent: {
        kind: 'command',
        target: 'node-agent',
        command: ['sh', '-lc', `test -s ${shellEscape(runtimeStatePath)}`]
      }
    }
  }
}

async function realReadTextFile(path: string): Promise<string> {
  return await Bun.file(path).text()
}

async function realWriteTextFile(path: string, contents: string): Promise<void> {
  await Bun.write(path, contents)
}

function hasCapNetAdmin(): boolean {
  try {
    const status = readFileSync('/proc/self/status', 'utf8')
    const raw = status
      .split('\n')
      .find(line => line.startsWith('CapEff:'))
      ?.split(':')[1]
      ?.trim()
    if (!raw) return false
    const bit = 1n << 12n
    return (BigInt(`0x${raw}`) & bit) === bit
  } catch {
    return false
  }
}

function runVersionCommand(command: readonly string[]) {
  const child = Bun.spawnSync([...command], {
    cwd: rootDir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString().trim(),
    stderr: child.stderr.toString().trim()
  }
}

function startDetached(
  command: readonly string[],
  logFile: string,
  env: Record<string, string>
): number {
  const envParts = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(value)}`)
  const commandParts = command.map(shellEscape)
  const script = `cd ${shellEscape(rootDir)} && nohup env ${envParts.join(' ')} ${commandParts.join(' ')} > ${shellEscape(logFile)} 2>&1 < /dev/null & printf '%s' $!`
  const started = Bun.spawnSync(['sh', '-lc', script], {
    cwd: rootDir,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const stdout = started.stdout.toString().trim()
  const stderr = started.stderr.toString().trim()
  if (started.exitCode !== 0 || stdout.length === 0) {
    throw new Error(stderr || stdout || `failed to start ${command.join(' ')}`)
  }
  return Number(stdout)
}

async function postgresReady(databaseUrl: string): Promise<boolean> {
  const client = createSqlClient(databaseUrl)
  try {
    await client`select 1`
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function natsReady(natsUrl: string): Promise<boolean> {
  try {
    const connection = await connectToNats(natsUrl)
    await connection.drain()
    return true
  } catch {
    return false
  }
}

async function probeReadyEndpoint(url: string, internalToken?: string): Promise<boolean> {
  try {
    const headers = internalToken ? { 'x-meristem-internal-token': internalToken } : undefined
    const response = await fetch(url, { headers })
    const body = (await response.json().catch(() => null)) as {
      ready?: boolean
      ok?: boolean
    } | null
    return response.ok && (body?.ready === true || body?.ok === true)
  } catch {
    return false
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 进程已退出时，停止语义已经满足。
  }
}

const defaultDeps: DeployProofDeps = {
  ensureKeycloakDevRealm,
  hasCapNetAdmin,
  isPidAlive,
  killPid,
  loadRuntimeDeploymentConfig: (env, readTextFile) =>
    loadRuntimeDeploymentConfig({ env, readTextFile }),
  now: () => new Date(),
  postgresReady,
  prepareInfra: () => prepareInfra({ apisix: false, opensearch: false, redis: false }),
  prepareWorkspace,
  probeReadyEndpoint,
  readTextFile: realReadTextFile,
  runVersionCommand,
  sleep: Bun.sleep,
  startDetached,
  writeTextFile: realWriteTextFile,
  natsReady
}

async function prepareContext(
  target: DeployTarget,
  authMode: DeployAuthMode,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<PreparedContext | DeployProofReport> {
  const paths = proofPaths(target, authMode)
  mkdirSync(paths.workspaceDir, { recursive: true })
  mkdirSync(paths.logDir, { recursive: true })
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  const keycloak = await deps.ensureKeycloakDevRealm()
  if (!keycloak.ok) {
    const report = prerequisiteMissing(
      'keycloak.start',
      keycloak.step,
      keycloak.message,
      'Keycloak dev realm is required for deploy proof orchestration'
    )
    results.push(report)
    services.keycloak = {
      status: 'prerequisite-missing',
      detail: keycloak.message
    }
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }

  services.keycloak = {
    status: keycloak.startedNow ? 'started' : 'reused',
    detail: `${keycloak.realm.runtime}:${keycloak.realm.hostPort}`,
    endpoint: keycloak.realm.discoveryUrl
  }
  results.push(success('keycloak.start', `${keycloak.realm.runtime}:${keycloak.realm.hostPort}`))

  const discoveryResponse = await fetch(keycloak.realm.discoveryUrl)
  if (!discoveryResponse.ok) {
    results.push(
      failure(
        'keycloak.discovery',
        'keycloak.discovery_unreachable',
        'Keycloak discovery endpoint did not become reachable',
        `HTTP ${discoveryResponse.status}`
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('keycloak.discovery', keycloak.realm.discoveryUrl))

  const jwksResponse = await fetch(keycloak.realm.jwksUrl)
  const jwksPayload = (await jwksResponse.json().catch(() => null)) as {
    keys?: readonly unknown[]
  } | null
  if (!jwksResponse.ok || !Array.isArray(jwksPayload?.keys) || jwksPayload.keys.length === 0) {
    results.push(
      failure(
        'keycloak.jwks',
        'keycloak.jwks_unreachable',
        'Keycloak JWKS endpoint returned no signing keys',
        `HTTP ${jwksResponse.status}`
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('keycloak.jwks', `${jwksPayload.keys.length} signing key(s)`))

  const deploymentConfig = buildDeploymentConfig(
    keycloak.realm,
    target,
    authMode,
    paths.runtimeStatePath
  )
  await deps.writeTextFile(
    paths.deploymentConfigPath,
    `${JSON.stringify(deploymentConfig, null, 2)}\n`
  )

  const sharedEnv = {
    ...normalizeEnv(process.env),
    [RUNTIME_DEPLOYMENT_CONFIG_ENV]: paths.deploymentConfigPath,
    [keycloakClientSecretEnvVar]: keycloak.realm.clientSecret,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem',
    MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: process.env.MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS ?? '500',
    MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS ?? '2000',
    MERISTEM_AGENT_TASK_TIMEOUT_MS: process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS ?? '2000',
    MERISTEM_CORE_HOST: '127.0.0.1',
    MERISTEM_CORE_URL: 'http://127.0.0.1:3000',
    MERISTEM_EVENTBUS_URL: 'http://127.0.0.1:3103',
    MERISTEM_EXTENSION_URL: 'http://127.0.0.1:3106',
    MERISTEM_INTERNAL_TOKEN: process.env.MERISTEM_INTERNAL_TOKEN ?? 'deploy-proof-internal-token',
    MERISTEM_JOIN_PUBLIC_URL: 'https://127.0.0.1:8443',
    MERISTEM_JOIN_URL: 'wss://127.0.0.1:8443/join/v0/session',
    MERISTEM_JWT_SECRET: process.env.MERISTEM_JWT_SECRET ?? 'deploy-proof-jwt-secret-32-characters',
    MERISTEM_MNET_CONTROL_URL: 'http://127.0.0.1:3104',
    MERISTEM_MNET_URL: 'http://127.0.0.1:3104',
    MERISTEM_NODE_RUNTIME_STATE_PATH: paths.runtimeStatePath,
    MERISTEM_POLICY_URL: 'http://127.0.0.1:3101',
    MERISTEM_TASK_URL: 'http://127.0.0.1:3105',
    MERISTEM_BFF_PORT: '3200',
    NATS_URL: process.env.NATS_URL ?? 'ws://localhost:4223',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    NO_PROXY: '127.0.0.1,localhost',
    PORT: '3000'
  }
  Object.assign(process.env, sharedEnv)

  const runtimeConfigResult = await deps.loadRuntimeDeploymentConfig(
    { [RUNTIME_DEPLOYMENT_CONFIG_ENV]: paths.deploymentConfigPath },
    deps.readTextFile
  )
  if (!runtimeConfigResult.ok) {
    results.push(
      failure(
        'deployment-config.load',
        runtimeConfigResult.error.code,
        runtimeConfigResult.error.message
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('deployment-config.load', runtimeConfigResult.value.deploymentTarget))

  if (!runtimeConfigResult.value.raw.nodeAgentCapabilities.netAdmin) {
    results.push(
      prerequisiteMissing(
        'node-agent.capability',
        'node-agent.net_admin_disabled',
        'Deployment config does not declare CAP_NET_ADMIN for node-agent runtime'
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }

  if (!deps.hasCapNetAdmin()) {
    results.push(
      prerequisiteMissing(
        'node-agent.capability',
        'node-agent.cap_net_admin_missing',
        'Current shell does not carry CAP_NET_ADMIN required by node-agent host capability checks'
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }

  const wgVersion = deps.runVersionCommand([
    runtimeConfigResult.value.raw.nodeAgentCapabilities.wgBinaryPath,
    '--version'
  ])
  if (wgVersion.exitCode !== 0) {
    results.push(
      prerequisiteMissing(
        'node-agent.wg',
        'node-agent.wg_missing',
        'Configured WireGuard binary is not executable',
        runtimeConfigResult.value.raw.nodeAgentCapabilities.wgBinaryPath
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(success('node-agent.wg', wgVersion.stdout || wgVersion.stderr))

  if (!existsSync(runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath)) {
    results.push(
      prerequisiteMissing(
        'node-agent.wireguard-module',
        'node-agent.wireguard_module_missing',
        'Configured WireGuard module path is not visible on the host',
        runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(
    success(
      'node-agent.wireguard-module',
      runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath
    )
  )

  const secretManager = createRuntimeSecretManager(runtimeConfigResult.value, sharedEnv)
  const deploymentBindings = await resolveDeploymentSecretBindings(
    secretManager,
    runtimeConfigResult.value.raw.secretBindings
  )
  if (!deploymentBindings.ok) {
    results.push(
      failure(
        'secret-provider.bindings',
        deploymentBindings.error.code,
        'SecretProvider failed to resolve deployment bindings',
        deploymentBindings.error.message
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(
    success(
      'secret-provider.bindings',
      `${Object.keys(deploymentBindings.value).length} binding(s) resolved`
    )
  )

  if (runtimeConfigResult.value.auth.provider === 'oidc') {
    try {
      await resolveCoreOidcStartupSecrets(runtimeConfigResult.value, secretManager)
      results.push(success('auth.mode', `oidc:${runtimeConfigResult.value.auth.issuer}`))
    } catch (error) {
      results.push(
        failure(
          'auth.mode',
          'auth.oidc_secret_resolution_failed',
          'OIDC auth provider selection failed closed before service startup',
          error instanceof Error ? error.message : String(error)
        )
      )
      return finalizeReport(
        target,
        authMode,
        paths.deploymentConfigPath,
        runtimeConfigResult.value,
        services,
        results
      )
    }
  } else {
    results.push(success('auth.mode', 'local-dev'))
  }

  return {
    authMode,
    keycloakRealm: keycloak.realm,
    paths,
    runtimeConfig: runtimeConfigResult.value,
    sharedEnv,
    target
  }
}

async function ensureInfraAndWorkspace(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  const databaseUrl =
    context.sharedEnv.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem'
  const natsUrl = context.sharedEnv.NATS_URL ?? 'ws://localhost:4223'
  const postgresWasReady = await deps.postgresReady(databaseUrl)
  const natsWasReady = await deps.natsReady(natsUrl)
  if (!postgresWasReady || !natsWasReady) {
    const dockerVersion = deps.runVersionCommand(['docker', '--version'])
    const composeVersion = deps.runVersionCommand(['docker', 'compose', 'version'])
    if (dockerVersion.exitCode !== 0 || composeVersion.exitCode !== 0) {
      const result = prerequisiteMissing(
        'infra.compose',
        'infra.compose_missing',
        'docker + docker compose are required when PostgreSQL or NATS are not already reachable'
      )
      results.push(result)
      services.postgres = { status: 'prerequisite-missing', detail: result.message }
      services.nats = { status: 'prerequisite-missing', detail: result.message }
      return false
    }

    try {
      await deps.prepareInfra()
    } catch (error) {
      results.push(
        failure(
          'infra.start',
          'infra.start_failed',
          'Failed to start PostgreSQL/NATS for deploy proof',
          error instanceof Error ? error.message : String(error)
        )
      )
      services.postgres = { status: 'failure', detail: 'docker compose up failed' }
      services.nats = { status: 'failure', detail: 'docker compose up failed' }
      return false
    }
  }

  const postgresReadyNow = await deps.postgresReady(databaseUrl)
  const natsReadyNow = await deps.natsReady(natsUrl)
  if (!postgresReadyNow || !natsReadyNow) {
    results.push(
      failure(
        'infra.readiness',
        'infra.not_ready',
        'PostgreSQL or NATS still failed readiness after orchestration',
        `postgres=${postgresReadyNow} nats=${natsReadyNow}`
      )
    )
    return false
  }

  services.postgres = {
    status: postgresWasReady ? 'reused' : 'ready',
    detail: databaseUrl
  }
  services.nats = {
    status: natsWasReady ? 'reused' : 'ready',
    detail: natsUrl
  }
  results.push(
    success(
      'infra.postgres',
      postgresWasReady ? 'reused existing PostgreSQL' : 'started PostgreSQL'
    )
  )
  results.push(success('infra.nats', natsWasReady ? 'reused existing NATS' : 'started NATS'))

  try {
    await deps.prepareWorkspace()
    results.push(success('workspace.prepare', 'certs, migration, seed, and defaults prepared'))
    return true
  } catch (error) {
    results.push(
      failure(
        'workspace.prepare',
        'workspace.prepare_failed',
        'Failed to prepare workspace prerequisites for deploy proof',
        error instanceof Error ? error.message : String(error)
      )
    )
    return false
  }
}

async function waitForServiceReadiness(
  context: PreparedContext,
  definition: ManagedServiceDefinition,
  deps: DeployProofDeps,
  timeoutMs = 60_000
): Promise<boolean> {
  const startedAt = deps.now().getTime()
  const readiness = context.runtimeConfig.raw.readiness[definition.readinessKey]
  if (!readiness) return false
  const endpoint = readiness.endpoint
  if (!endpoint) return false
  while (deps.now().getTime() - startedAt < timeoutMs) {
    if (await deps.probeReadyEndpoint(endpoint, context.sharedEnv.MERISTEM_INTERNAL_TOKEN)) {
      return true
    }
    await deps.sleep(500)
  }
  return false
}

async function ensureManagedServices(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  for (const definition of managedServices) {
    const endpoint = context.runtimeConfig.raw.readiness[definition.readinessKey]?.endpoint
    if (
      endpoint &&
      (await deps.probeReadyEndpoint(endpoint, context.sharedEnv.MERISTEM_INTERNAL_TOKEN))
    ) {
      services[definition.name] = {
        status: 'reused',
        detail: 'service already responded to readiness probe',
        endpoint
      }
      results.push(success(`service.${definition.name}`, `reused ${endpoint}`))
      continue
    }

    const prior = loadStoredState(context.paths.stateFile).services[definition.name]
    if (prior && deps.isPidAlive(prior.pid)) {
      deps.killPid(prior.pid)
      await deps.sleep(1_000)
      updateStoredService(context.paths.stateFile, definition.name, null)
    }

    const logFile = join(context.paths.logDir, `${definition.name}.log`)
    try {
      const pid = deps.startDetached(definition.command, logFile, context.sharedEnv)
      updateStoredService(context.paths.stateFile, definition.name, {
        logFile,
        pid,
        startedAt: deps.now().toISOString()
      })

      const ready = await waitForServiceReadiness(context, definition, deps)
      if (!ready) {
        services[definition.name] = {
          status: 'failure',
          detail: 'service did not become ready before timeout',
          ...(endpoint ? { endpoint } : {}),
          logFile,
          pid
        }
        results.push(
          failure(
            `service.${definition.name}`,
            'service.readiness_timeout',
            `Service ${definition.name} did not become ready in time`,
            tailLogFile(logFile)
          )
        )
        return false
      }

      services[definition.name] = {
        status: prior ? 'restarted' : 'started',
        detail: `service ready on ${endpoint ?? 'unknown endpoint'}`,
        ...(endpoint ? { endpoint } : {}),
        logFile,
        pid
      }
      results.push(success(`service.${definition.name}`, `started ${endpoint ?? definition.name}`))
    } catch (error) {
      services[definition.name] = {
        status: 'failure',
        detail: error instanceof Error ? error.message : String(error),
        ...(endpoint ? { endpoint } : {}),
        logFile
      }
      results.push(
        failure(
          `service.${definition.name}`,
          'service.start_failed',
          `Failed to start ${definition.name}`,
          error instanceof Error ? error.message : String(error)
        )
      )
      return false
    }
  }

  const joinHealthReady = await deps.probeReadyEndpoint(joinHealthUrl)
  if (!joinHealthReady) {
    results.push(
      failure(
        'service.m-net.join-ingress',
        'mnet.join_ingress_not_ready',
        'M-Net join ingress did not expose the public health endpoint',
        joinHealthUrl
      )
    )
    return false
  }
  results.push(success('service.m-net.join-ingress', joinHealthUrl))
  return true
}

function readRuntimeState(
  path: string
): { readonly nodeId: string; readonly runtimeToken: string; readonly savedAt: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      nodeId?: unknown
      runtimeToken?: unknown
      savedAt?: unknown
    }
    return typeof parsed.nodeId === 'string' &&
      typeof parsed.runtimeToken === 'string' &&
      typeof parsed.savedAt === 'string'
      ? {
          nodeId: parsed.nodeId,
          runtimeToken: parsed.runtimeToken,
          savedAt: parsed.savedAt
        }
      : null
  } catch {
    return null
  }
}

async function mintOperatorToken(context: PreparedContext): Promise<string> {
  if (context.runtimeConfig.auth.provider === 'oidc') {
    const minted = await mintKeycloakTokenForActor(context.keycloakRealm, 'operator')
    return minted.accessToken
  }
  return await mintLocalToken({
    actor: 'operator',
    secret: context.sharedEnv.MERISTEM_JWT_SECRET ?? 'deploy-proof-jwt-secret-32-characters'
  })
}

async function createJoinTicket(context: PreparedContext): Promise<JoinTicketResult> {
  const token = await mintOperatorToken(context)
  const response = await fetch(
    `${context.runtimeConfig.raw.serviceUrls.core}/api/v0/node-tickets`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        kind: 'stem',
        name: `deploy-proof-${context.target}-${Date.now()}`
      })
    }
  )

  if (!response.ok) {
    return {
      ok: false,
      result: failure(
        'auth.operator-ticket',
        response.status === 401 || response.status === 403
          ? 'auth.operator_token_rejected'
          : 'core.join_ticket_failed',
        'Failed to verify configured auth mode through Core join-ticket creation',
        `HTTP ${response.status}`
      )
    }
  }

  const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null
  if (typeof body?.ticket !== 'string' || body.ticket.length === 0) {
    return {
      ok: false,
      result: failure(
        'auth.operator-ticket',
        'core.join_ticket_invalid',
        'Core join-ticket route did not return a ticket string'
      )
    }
  }

  return { ok: true, ticket: body.ticket }
}

async function waitForRuntimeStateUpdate(
  path: string,
  previousSavedAt: string | null,
  deps: DeployProofDeps,
  timeoutMs = 45_000
): Promise<ReturnType<typeof readRuntimeState>> {
  const startedAt = deps.now().getTime()
  while (deps.now().getTime() - startedAt < timeoutMs) {
    const runtime = readRuntimeState(path)
    if (runtime && (previousSavedAt === null || runtime.savedAt !== previousSavedAt)) {
      return runtime
    }
    await deps.sleep(500)
  }
  return null
}

async function startNodeAgentWithJoinTicket(
  context: PreparedContext,
  joinTicket: string,
  previousSavedAt: string | null,
  deps: DeployProofDeps
): Promise<
  | {
      readonly ok: true
      readonly pid: number
      readonly runtime: NonNullable<ReturnType<typeof readRuntimeState>>
    }
  | {
      readonly ok: false
      readonly result: DeployProofResult
      readonly pid?: number
      readonly logFile: string
    }
> {
  rmSync(context.paths.runtimeStatePath, { force: true })
  const logFile = join(context.paths.logDir, 'node-agent.log')
  const pid = deps.startDetached(['bun', 'run', 'services/node-agent/src/index.ts'], logFile, {
    ...context.sharedEnv,
    MERISTEM_JOIN_TICKET: joinTicket,
    MERISTEM_HOST_PRIVATE_KEY_PATH: join(context.paths.workspaceDir, 'wg', 'private.key')
  })
  const runtime = await waitForRuntimeStateUpdate(
    context.paths.runtimeStatePath,
    previousSavedAt,
    deps
  )
  if (!runtime) {
    return {
      ok: false,
      pid,
      logFile,
      result: failure(
        'service.node-agent',
        'node-agent.session_timeout',
        'Node-agent did not establish a session after fresh join',
        tailLogFile(logFile)
      )
    }
  }
  return { ok: true, pid, runtime }
}

async function ensureNodeAgent(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  const priorState = loadStoredState(context.paths.stateFile).services['node-agent']
  if (priorState && deps.isPidAlive(priorState.pid)) {
    deps.killPid(priorState.pid)
    await deps.sleep(1_000)
    updateStoredService(context.paths.stateFile, 'node-agent', null)
  }

  const previousRuntime = readRuntimeState(context.paths.runtimeStatePath)
  const joinTicketResult = await createJoinTicket(context)
  if (!joinTicketResult.ok) {
    results.push(joinTicketResult.result)
    services['node-agent'] = {
      status: 'failure',
      detail: joinTicketResult.result.message
    }
    return false
  }
  results.push(
    success('auth.operator-ticket', 'Core accepted operator token and minted a join ticket')
  )

  const started = await startNodeAgentWithJoinTicket(
    context,
    joinTicketResult.ticket,
    previousRuntime?.savedAt ?? null,
    deps
  )
  if (!started.ok) {
    if (started.pid) deps.killPid(started.pid)
    results.push(started.result)
    services['node-agent'] = {
      status: 'failure',
      detail: 'message' in started.result ? started.result.message : started.result.detail,
      logFile: started.logFile,
      ...(started.pid ? { pid: started.pid } : {})
    }
    return false
  }

  updateStoredService(context.paths.stateFile, 'node-agent', {
    logFile: join(context.paths.logDir, 'node-agent.log'),
    pid: started.pid,
    startedAt: deps.now().toISOString()
  })
  services['node-agent'] = {
    status: 'started',
    detail: `session established for ${started.runtime.nodeId}`,
    logFile: join(context.paths.logDir, 'node-agent.log'),
    pid: started.pid
  }
  results.push(success('service.node-agent', `session established for ${started.runtime.nodeId}`))
  return true
}

function finalizeReport(
  target: DeployTarget,
  authMode: DeployAuthMode,
  deploymentConfigPath: string,
  runtimeConfig: RuntimeDeploymentConfig | null,
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  results: readonly DeployProofResult[]
): DeployProofReport {
  const verdict: DeployVerdict = results.some(result => result.status === 'failure')
    ? 'failure'
    : results.some(result => result.status === 'prerequisite-missing')
      ? 'prerequisite-missing'
      : 'pass'

  return {
    auth: {
      mode: authMode,
      provider: runtimeConfig?.auth.provider ?? authMode,
      keycloakDiscoveryUrl: services.keycloak?.endpoint ?? 'unavailable',
      keycloakJwksUrl:
        runtimeConfig?.auth.provider === 'oidc'
          ? (runtimeConfig.auth.discoveryUrl ?? runtimeConfig.auth.issuer)
          : (services.keycloak?.detail ?? 'unavailable')
    },
    deploymentConfigPath,
    proof: `v02-deploy-${target}`,
    results,
    secretProvider: {
      backend: runtimeConfig?.secretProvider.backend ?? 'local-dev-env',
      providerName: runtimeConfig?.secretProvider.providerName ?? 'runtime'
    },
    services,
    target,
    verdict
  }
}

export async function runV02DeployProof(
  input: { readonly argv?: readonly string[] } = {},
  overrideDeps: Partial<DeployProofDeps> = {}
): Promise<DeployProofReport> {
  const deps = { ...defaultDeps, ...overrideDeps }
  const argv = input.argv ?? process.argv
  const target = targetFromArgv(argv)
  const authMode = authModeFromArgv(argv)
  const invalidTargetPath = proofPaths('nixos', 'oidc').deploymentConfigPath
  if (!target) {
    return finalizeReport('nixos', 'oidc', invalidTargetPath, null, {}, [
      failure(
        'target',
        'target.invalid',
        'Deploy proof only supports --target=nixos or --target=oci'
      )
    ])
  }
  if (!authMode) {
    return finalizeReport(
      target,
      'oidc',
      proofPaths(target, 'oidc').deploymentConfigPath,
      null,
      {},
      [
        failure(
          'auth.mode',
          'auth.mode_invalid',
          'Deploy proof only supports --auth=oidc or --auth=local-dev'
        )
      ]
    )
  }

  const results: DeployProofResult[] = []
  const services: Partial<Record<ManagedServiceName, ServiceEvidence>> = {}
  const prepared = await prepareContext(target, authMode, results, services, deps)
  if ('verdict' in prepared) return prepared

  if (!(await ensureInfraAndWorkspace(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }
  if (!(await ensureManagedServices(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }
  if (!(await ensureNodeAgent(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }

  return finalizeReport(
    target,
    authMode,
    prepared.paths.deploymentConfigPath,
    prepared.runtimeConfig,
    services,
    results
  )
}

if (import.meta.main) {
  const report = await runV02DeployProof({ argv: process.argv })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}
