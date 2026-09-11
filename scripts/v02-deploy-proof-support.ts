/**
 * v02 deploy proof 的环境/进程工具与受管服务定义（从 v02-deploy-proof.ts 拆出，行为不变）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeDeploymentConfig } from '../packages/config/src/index.ts'
import { loadRuntimeDeploymentConfig } from '../packages/config/src/index.ts'
import type { DeploymentConfigV02FromSchema } from '../packages/contracts/src/index.ts'
import { createSqlClient } from '../packages/db/src/client.ts'
import { connectToNats } from '../packages/nats-rpc/src/index.ts'
import type { KeycloakRealmState } from './keycloak-dev-realm.ts'
import { buildKeycloakDeploymentConfig, ensureKeycloakDevRealm } from './keycloak-dev-realm.ts'
import { prepareInfra, prepareWorkspace, rootDir } from './local-stack-runtime.ts'
import type {
  DeployAuthMode,
  DeployProofDeps,
  DeployProofReport,
  DeployProofResult,
  DeployTarget,
  DeployVerdict,
  FailureResult,
  ManagedServiceDefinition,
  ManagedServiceName,
  ManagedServiceState,
  PrerequisiteMissingResult,
  ProofPaths,
  ServiceEvidence,
  StoredState,
  SuccessResult
} from './v02-deploy-proof-types.ts'

export const joinHealthUrl = 'https://127.0.0.1:8443/join/v0/health'
export const managedServices: readonly ManagedServiceDefinition[] = [
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

export function success(step: string, detail: string): SuccessResult {
  return { status: 'success', step, detail }
}

export function prerequisiteMissing(
  step: string,
  code: string,
  message: string,
  detail?: string
): PrerequisiteMissingResult {
  return { status: 'prerequisite-missing', step, code, message, ...(detail ? { detail } : {}) }
}

export function failure(
  step: string,
  code: string,
  message: string,
  detail?: string
): FailureResult {
  return { status: 'failure', step, code, message, ...(detail ? { detail } : {}) }
}

export function targetFromArgv(argv: readonly string[]): DeployTarget | null {
  const raw =
    argv.find(argument => argument.startsWith('--target='))?.split('=')[1] ??
    process.env.DEPLOY_TARGET ??
    'nixos'
  return raw === 'nixos' || raw === 'oci' ? raw : null
}

export function authModeFromArgv(argv: readonly string[]): DeployAuthMode | null {
  const raw =
    argv.find(argument => argument.startsWith('--auth='))?.split('=')[1] ??
    process.env.MERISTEM_DEPLOY_PROOF_AUTH_MODE ??
    'oidc'
  return raw === 'oidc' || raw === 'local-dev' ? raw : null
}

export function proofPaths(target: DeployTarget, authMode: DeployAuthMode): ProofPaths {
  const workspaceDir = join(rootDir, '.local', 'v02-deploy-proof')
  return {
    workspaceDir,
    logDir: join(workspaceDir, 'logs'),
    stateFile: join(workspaceDir, 'state.json'),
    deploymentConfigPath: join(workspaceDir, `deployment-${target}-${authMode}.json`),
    runtimeStatePath: join(workspaceDir, `node-agent-runtime-${target}-${authMode}.json`)
  }
}

export function normalizeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  )
}

export function _requiredEnv(env: Record<string, string>, key: string): string {
  const value = env[key]
  if (!value) throw new Error(`${key} is required`)
  return value
}

export function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function tailLogFile(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    return lines.slice(-20).join('\n')
  } catch {
    return 'log file not readable'
  }
}

export function loadStoredState(path: string): StoredState {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredState
  } catch {
    return { services: {} }
  }
}

export function saveStoredState(path: string, state: StoredState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * 真实 proof 仍然要显式记录本地进程状态，避免重复启动造成端口冲突或 session 抖动。
 */
export function updateStoredService(
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

export function buildDeploymentConfig(
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

export async function realReadTextFile(path: string): Promise<string> {
  return await Bun.file(path).text()
}

export async function realWriteTextFile(path: string, contents: string): Promise<void> {
  await Bun.write(path, contents)
}

export function hasCapNetAdmin(): boolean {
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

export function runVersionCommand(command: readonly string[]) {
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

export function startDetached(
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

export async function postgresReady(databaseUrl: string): Promise<boolean> {
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

export async function natsReady(natsUrl: string): Promise<boolean> {
  try {
    const connection = await connectToNats(natsUrl)
    await connection.drain()
    return true
  } catch {
    return false
  }
}

export async function probeReadyEndpoint(url: string, internalToken?: string): Promise<boolean> {
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

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 进程已退出时，停止语义已经满足。
  }
}

export const defaultDeps: DeployProofDeps = {
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

export function finalizeReport(
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
