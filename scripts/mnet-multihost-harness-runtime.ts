import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import {
  NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY,
  NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY,
  NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY,
  resolveNetworkMapSigningKeyMaterial
} from '@m-net/data-plane/network-map-signing.ts'
import { internalServicePorts } from '../packages/internal-http/src/index.ts'
import { rootDir } from './local-stack-runtime.ts'
import type { HarnessState } from './mnet-multihost-harness-contract.ts'

const dockerImage = 'oven/bun:1'
const harnessDir = join(rootDir, '.local', 'mnet-multihost')
const logDir = join(harnessDir, 'logs')
const stateFile = join(harnessDir, 'state.json')
const relayPort = 18443
const relayHealthPort = 19090
const relayPathPrefix = 'meristem-fallback-relay'
const hostSystemBinDir = '/run/current-system/sw/bin'
const containerPath = `${hostSystemBinDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
const controlCoreUrl = 'http://127.0.0.1:3000'
const controlMnetUrl = `http://host.docker.internal:${internalServicePorts['m-net']}`
const mNetInternalUrl = `http://127.0.0.1:${internalServicePorts['m-net']}`
const controlReadyUrl = `${controlCoreUrl}/api/v0/ready`
const nodeListUrl = `${controlCoreUrl}/api/v0/nodes`

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function ensureHarnessDirs(): void {
  mkdirSync(logDir, { recursive: true })
}

const proxyEnvKeys = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY'
] as const

function stripProxyEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (proxyEnvKeys.includes(key as (typeof proxyEnvKeys)[number])) continue
    result[key] = value
  }
  return result
}

function run(command: readonly string[], cwd = rootDir, env = stripProxyEnv(process.env)) {
  try {
    const child = Bun.spawnSync([...command], {
      cwd,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    return {
      exitCode: child.exitCode,
      stderr: child.stderr.toString().trim(),
      stdout: child.stdout.toString().trim()
    }
  } catch (error) {
    return {
      exitCode: 127,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: ''
    }
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readCapEffHex(): string | null {
  try {
    const status = readFileSync('/proc/self/status', 'utf8')
    const capEffLine = status
      .split('\n')
      .find(line => line.startsWith('CapEff:'))
      ?.split(':')[1]
      ?.trim()
    return capEffLine ?? null
  } catch {
    return null
  }
}

function hasCapNetAdmin(): boolean {
  const capEffHex = readCapEffHex()
  if (!capEffHex) return false
  const bit = 1n << 12n
  return (BigInt(`0x${capEffHex}`) & bit) === bit
}

function resolveBinary(binaryPath: string): string | null {
  const version = run([binaryPath, '--version'])
  return version.exitCode === 0 ? version.stdout || version.stderr : null
}

async function probeDockerGateway(): Promise<boolean> {
  const probeNetworkName = `meristem-mnet-harness-probe-${Date.now()}`
  const server = createServer(socket => {
    socket.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => resolve())
  })
  try {
    const address = server.address()
    const probePort =
      typeof address === 'object' && address !== null && typeof address.port === 'number'
        ? address.port
        : null
    if (probePort === null) return false
    const networkCreate = run(['docker', 'network', 'create', probeNetworkName])
    if (networkCreate.exitCode !== 0) return false
    const probe = run([
      'docker',
      'run',
      '--rm',
      '--network',
      probeNetworkName,
      '--add-host',
      'host.docker.internal:host-gateway',
      dockerImage,
      'bun',
      '--eval',
      `const { Socket } = require('node:net'); const socket = new Socket(); socket.setTimeout(3000); socket.on('connect', () => { socket.destroy(); process.exit(0); }); socket.on('timeout', () => { socket.destroy(); process.exit(9); }); socket.on('error', () => process.exit(10)); socket.connect(${probePort}, 'host.docker.internal');`
    ])
    return probe.exitCode === 0
  } finally {
    server.close()
    run(['docker', 'network', 'rm', probeNetworkName])
  }
}

function startDetached(
  command: readonly string[],
  logFile: string,
  env: Record<string, string>
): number {
  ensureHarnessDirs()
  const envParts = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(value)}`)
  const commandParts = command.map(shellEscape)
  const script = `cd ${shellEscape(rootDir)} && nohup env ${envParts.join(' ')} ${commandParts.join(' ')} > ${shellEscape(logFile)} 2>&1 < /dev/null & printf '%s' $!`
  const started = run(['sh', '-lc', script])
  if (started.exitCode !== 0 || started.stdout.length === 0) {
    throw new Error(
      `failed to start detached process for ${logFile}: ${started.stderr || started.stdout}`
    )
  }
  return Number(started.stdout)
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function dockerLeafLogFollower(containerName: string, logFile: string): number {
  return startDetached(
    ['docker', 'logs', '-f', containerName],
    logFile,
    process.env as Record<string, string>
  )
}

function normalizeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(stripProxyEnv(source)).flatMap(([key, value]) =>
    typeof value === 'string' ? [[key, value] as const] : []
  )
  return Object.fromEntries(entries)
}

function harnessEnv(): Record<string, string> {
  const signing = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
  return {
    ...normalizeEnv(process.env),
    NO_PROXY: '127.0.0.1,localhost,host.docker.internal,host.containers.internal',
    no_proxy: '127.0.0.1,localhost,host.docker.internal,host.containers.internal',
    MERISTEM_INTERNAL_TOKEN:
      process.env.MERISTEM_INTERNAL_TOKEN ?? 'mnet-multihost-harness-internal-token',
    MERISTEM_JWT_SECRET:
      process.env.MERISTEM_JWT_SECRET ?? 'mnet-multihost-harness-jwt-secret-32-chars',
    MERISTEM_JOIN_PUBLIC_URL: 'https://host.docker.internal:8443',
    MERISTEM_RELAY_ENDPOINT: `wss://host.docker.internal:${relayPort}`,
    MERISTEM_RELAY_PUBLIC_HOSTNAME: 'host.docker.internal',
    MERISTEM_RELAY_PUBLIC_PORT: String(relayPort),
    MERISTEM_RELAY_HEALTH_URL: `http://127.0.0.1:${relayHealthPort}/health`,
    MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '500',
    MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: '2000',
    [NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY]: signing.keyId,
    [NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY]: signing.privateKeyPem,
    [NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY]: signing.publicKey ?? ''
  }
}

function infraAlreadyRunning(): boolean {
  return (
    run(['docker', 'compose', 'ps', '-q', 'postgres']).stdout.length > 0 ||
    run(['docker', 'compose', 'ps', '-q', 'nats']).stdout.length > 0
  )
}

async function waitFor(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 60_000
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await Bun.sleep(500)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  return await response.json()
}

function toNodeRecords(value: unknown) {
  if (!value || typeof value !== 'object' || !('nodes' in value)) return []
  const nodes = value.nodes
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap(node => {
    if (!node || typeof node !== 'object') return []
    const id = typeof node.id === 'string' ? node.id : undefined
    const kind = typeof node.kind === 'string' ? node.kind : undefined
    const name = typeof node.name === 'string' ? node.name : undefined
    const status = typeof node.status === 'string' ? node.status : undefined
    return [{ id, kind, name, status }]
  })
}

function sanitizeLabel(label: string): string {
  return label.replaceAll(':', '-').replaceAll('/', '-')
}

function loadState(): HarnessState | null {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as HarnessState
  } catch {
    return null
  }
}

/** 多主机 Harness 的共享运行时配置与受控进程辅助操作。 */
export const harnessRuntime = {
  containerPath,
  controlCoreUrl,
  controlMnetUrl,
  controlReadyUrl,
  dockerImage,
  dockerLeafLogFollower,
  ensureHarnessDirs,
  fetchJson,
  harnessDir,
  harnessEnv,
  hasCapNetAdmin,
  hostSystemBinDir,
  infraAlreadyRunning,
  isPidAlive,
  logDir,
  mNetInternalUrl,
  nodeListUrl,
  probeDockerGateway,
  relayHealthPort,
  relayPathPrefix,
  relayPort,
  resolveBinary,
  run,
  sanitizeLabel,
  startDetached,
  stateFile,
  toNodeRecords,
  waitFor,
  writeJson,
  loadState
}
