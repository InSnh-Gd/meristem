import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import {
  internalServicePorts,
  internalTokenHeaderName
} from '../packages/internal-http/src/index.ts'
import {
  NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY,
  NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY,
  NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY,
  resolveNetworkMapSigningKeyMaterial
} from '../services/m-net/src/network-map-signing.ts'
import {
  coreServiceCommands,
  prepareInfra,
  prepareWorkspace,
  rootDir
} from './local-stack-runtime.ts'

export type HarnessIssueCode =
  | 'ok'
  | 'harness.not_started'
  | 'host.wireguard_missing'
  | 'host.wireguard_module_missing'
  | 'host.cap_net_admin_missing'
  | 'host.wstunnel_missing'
  | 'docker.unavailable'
  | 'docker.image_missing'
  | 'docker.gateway_unreachable'

export type HarnessCheckResult =
  | {
      readonly ok: true
      readonly code: 'ok'
      readonly message: string
      readonly mode: 'docker-bridge'
      readonly details: {
        readonly dockerImage: string
        readonly wgBinaryPath: string
        readonly wstunnelBinaryPath: string
      }
    }
  | {
      readonly ok: false
      readonly code: Exclude<HarnessIssueCode, 'ok'>
      readonly message: string
      readonly hint: string
    }

type HarnessServiceProcess = {
  readonly label: string
  readonly logFile: string
  readonly pid: number
}

type HarnessLeafState = {
  readonly containerName: string
  readonly leafName: string
  readonly logFile: string
  readonly logPid: number
}

export type HarnessState = {
  readonly dockerImage: string
  readonly dockerNetworkName: string
  readonly infraWasRunning: boolean
  readonly leafs: readonly HarnessLeafState[]
  readonly operatorToken: string
  readonly relay: {
    readonly healthUrl: string
    readonly logFile: string
    readonly pid: number
    readonly relayEndpoint: string
  }
  readonly services: readonly HarnessServiceProcess[]
  readonly startedAt: string
}

type HarnessNodeStatus = {
  readonly found: boolean
  readonly id: string | null
  readonly kind: string | null
  readonly leafName: string
  readonly logFile: string
  readonly status: string | null
}

export type HarnessStatus = {
  readonly active: boolean
  readonly controlPlane: {
    readonly ready: boolean
    readonly url: string
  }
  readonly issue?: HarnessCheckResult
  readonly leafs: readonly HarnessNodeStatus[]
  readonly logFiles: readonly string[]
  readonly relay: {
    readonly endpoint: string | null
    readonly healthUrl: string | null
    readonly ready: boolean
  }
}

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

function resolveBinary(binaryPath: string) {
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
    if (probePort === null) {
      return false
    }

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

export async function runPreflightChecks(): Promise<HarnessCheckResult> {
  const wgBinaryPath = process.env.MERISTEM_WG_BINARY_PATH ?? 'wg'
  const wstunnelBinaryPath = process.env.MERISTEM_WSTUNNEL_BINARY_PATH ?? 'wstunnel'

  if (!resolveBinary(wgBinaryPath)) {
    return {
      ok: false,
      code: 'host.wireguard_missing',
      message: `missing WireGuard binary at ${wgBinaryPath}`,
      hint: 'Install wireguard-tools or point MERISTEM_WG_BINARY_PATH at a valid wg binary.'
    }
  }

  if (!hasCapNetAdmin()) {
    return {
      ok: false,
      code: 'host.cap_net_admin_missing',
      message: 'CAP_NET_ADMIN is missing for the current host process',
      hint: 'Run the harness from a shell that carries CAP_NET_ADMIN, or use a wrapper such as sudo setcap/capsh before retrying.'
    }
  }

  if (run(['sh', '-lc', '[ -d /sys/module/wireguard ]']).exitCode !== 0) {
    return {
      ok: false,
      code: 'host.wireguard_module_missing',
      message: 'WireGuard kernel module is not visible at /sys/module/wireguard',
      hint: 'Load the wireguard kernel module before starting the multi-host harness.'
    }
  }

  if (!resolveBinary(wstunnelBinaryPath)) {
    return {
      ok: false,
      code: 'host.wstunnel_missing',
      message: `missing wstunnel binary at ${wstunnelBinaryPath}`,
      hint: 'Install wstunnel locally or point MERISTEM_WSTUNNEL_BINARY_PATH at a readable binary.'
    }
  }

  if (run(['docker', '--version']).exitCode !== 0) {
    return {
      ok: false,
      code: 'docker.unavailable',
      message: 'docker CLI is unavailable for leaf host isolation',
      hint: 'Install Docker and ensure the daemon is reachable before using the multi-host harness.'
    }
  }

  if (run(['docker', 'image', 'inspect', dockerImage]).exitCode !== 0) {
    return {
      ok: false,
      code: 'docker.image_missing',
      message: `${dockerImage} is not present locally for leaf host containers`,
      hint: `Run \`docker pull ${dockerImage}\` once, then rerun the harness preflight.`
    }
  }

  const gatewayReachable = await probeDockerGateway()

  return {
    ok: true,
    code: 'ok',
    message: gatewayReachable
      ? 'host capability, relay binary, and docker bridge checks passed'
      : 'host capability and binaries passed; gateway probe was inconclusive, so rely on harness start result',
    mode: 'docker-bridge',
    details: {
      dockerImage,
      wgBinaryPath,
      wstunnelBinaryPath
    }
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

type NodeRecord = {
  readonly id?: string
  readonly kind?: string
  readonly name?: string
  readonly status?: string
}

type CreatedHarnessNetwork = {
  readonly id: string
}

async function mintAdminToken(): Promise<string> {
  const tokenResult = run(['bun', 'run', 'token:mint', '--actor', 'admin'])
  if (tokenResult.exitCode !== 0) {
    throw new Error(`failed to mint admin token for multihost harness: ${tokenResult.stderr}`)
  }
  return tokenResult.stdout.trim()
}

async function createHarnessNetwork(
  targetLeafIds: readonly string[]
): Promise<CreatedHarnessNetwork> {
  const internalToken = process.env.MERISTEM_INTERNAL_TOKEN ?? ''
  if (!internalToken) {
    throw new Error('MERISTEM_INTERNAL_TOKEN is required to create the multihost harness network')
  }

  const createResponse = await fetch(`${mNetInternalUrl}/internal/v0/networks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [internalTokenHeaderName]: internalToken
    },
    body: JSON.stringify({
      name: `Harness Network ${new Date().toISOString()}`,
      profileVersion: 'm-net-default@0.1.0'
    })
  })
  if (!createResponse.ok) {
    throw new Error(
      `failed to create M-Net network for multihost harness: ${createResponse.status} ${await createResponse.text()}`
    )
  }

  const createBody = await createResponse.json()
  const created = Reflect.get(createBody as object, 'network')
  const networkId =
    typeof created === 'object' && created !== null ? Reflect.get(created, 'id') : undefined
  if (typeof networkId !== 'string' || networkId.length === 0) {
    throw new Error('multihost harness network creation returned no network id')
  }

  for (const nodeId of targetLeafIds) {
    const joinResponse = await fetch(
      `${mNetInternalUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/members`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [internalTokenHeaderName]: internalToken
        },
        body: JSON.stringify({ nodeId })
      }
    )
    if (!joinResponse.ok) {
      throw new Error(
        `failed to join node ${nodeId} to multihost harness network ${networkId}: ${joinResponse.status} ${await joinResponse.text()}`
      )
    }
  }

  return { id: networkId }
}

async function enableDataPlaneProfileFor(networkId: string): Promise<void> {
  const adminToken = await mintAdminToken()
  const response = await fetch(
    `${mNetInternalUrl}/api/v0/networks/${encodeURIComponent(networkId)}/profile`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        profileVersion: 'm-net-cn@0.2.0',
        reason: 'enable data plane for multihost harness validation'
      })
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    if (
      response.status === 409 &&
      errorText.includes('profile.enable.invalid_state') &&
      errorText.includes('cannot enable from enabled')
    ) {
      await waitFor('fresh signed network map', async () => {
        const mapResponse = await fetch(
          `${mNetInternalUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/network-map`,
          {
            headers: { [internalTokenHeaderName]: process.env.MERISTEM_INTERNAL_TOKEN ?? '' }
          }
        )
        return mapResponse.ok
      })
      return
    }

    throw new Error(
      `failed to enable M-Net data plane profile for multihost harness: ${response.status} ${errorText}`
    )
  }

  await waitFor('fresh signed network map', async () => {
    const mapResponse = await fetch(
      `${mNetInternalUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/network-map`,
      {
        headers: { [internalTokenHeaderName]: process.env.MERISTEM_INTERNAL_TOKEN ?? '' }
      }
    )
    return mapResponse.ok
  })
}

function toNodeRecords(value: unknown): readonly NodeRecord[] {
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

async function createNodeJoinTicket(
  operatorToken: string,
  nodeName: string,
  kind: 'stem' | 'leaf'
): Promise<string> {
  const response = await fetch(`${controlCoreUrl}/api/v0/node-tickets`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${operatorToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ kind, name: nodeName })
  })

  if (!response.ok) {
    throw new Error(`failed to create join ticket for ${nodeName}: ${response.status}`)
  }

  const body = await response.json()
  if (!body || typeof body !== 'object' || !('ticket' in body) || typeof body.ticket !== 'string') {
    throw new Error(`join ticket response for ${nodeName} did not include a ticket string`)
  }
  return body.ticket
}

function sanitizeLabel(label: string): string {
  return label.replaceAll(':', '-').replaceAll('/', '-')
}

export async function startTopology(): Promise<HarnessStatus> {
  ensureHarnessDirs()
  const preflight = await runPreflightChecks()
  if (!preflight.ok)
    return {
      active: false,
      controlPlane: { ready: false, url: controlReadyUrl },
      issue: preflight,
      leafs: [],
      logFiles: [],
      relay: { endpoint: null, healthUrl: null, ready: false }
    }

  await stopTopology(false)

  const env = harnessEnv()
  const infraWasRunning = infraAlreadyRunning()
  let relayPid: number | null = null
  const serviceProcesses: HarnessServiceProcess[] = []
  const leafStates: HarnessLeafState[] = []
  let dockerNetworkName: string | null = null

  try {
    await prepareInfra({ apisix: false, opensearch: false, redis: false })
    Object.assign(process.env, env)
    await prepareWorkspace()

    const relayLogFile = join(logDir, 'relay.log')
    relayPid = startDetached(['bun', 'run', 'scripts/mnet-multihost-relay.ts'], relayLogFile, {
      ...env,
      MERISTEM_MNET_HARNESS_RELAY_PORT: String(relayPort),
      MERISTEM_MNET_HARNESS_RELAY_HEALTH_PORT: String(relayHealthPort),
      MERISTEM_MNET_HARNESS_RELAY_PATH_PREFIX: relayPathPrefix,
      MERISTEM_MNET_HARNESS_RELAY_CERT_FILE: join(rootDir, '.local/certs/join-ingress-cert.pem'),
      MERISTEM_MNET_HARNESS_RELAY_KEY_FILE: join(rootDir, '.local/certs/join-ingress-key.pem')
    })

    serviceProcesses.push(
      ...coreServiceCommands.map(service => {
        const logFile = join(logDir, `${sanitizeLabel(service.label)}.log`)
        const pid = startDetached(['bun', 'run', ...service.command.slice(2)], logFile, env)
        return { label: service.label, logFile, pid }
      })
    )

    await waitFor('core readiness', async () => {
      try {
        const body = await fetchJson(controlReadyUrl)
        return Boolean(body && typeof body === 'object' && 'ready' in body && body.ready === true)
      } catch {
        return false
      }
    })

    await waitFor('relay health', async () => {
      if (relayPid === null || !isPidAlive(relayPid)) {
        return false
      }
      try {
        const response = await fetch(`http://127.0.0.1:${relayHealthPort}/health`)
        return response.ok
      } catch {
        return false
      }
    })

    const operatorToken = process.env.MERISTEM_TOKEN
    if (!operatorToken) {
      throw new Error('prepareWorkspace did not yield MERISTEM_TOKEN for harness startup')
    }

    const startedAt = Date.now()
    dockerNetworkName = `meristem-mnet-harness-${startedAt}`
    const networkCreate = run(['docker', 'network', 'create', dockerNetworkName])
    if (networkCreate.exitCode !== 0) {
      throw new Error(
        `failed to create docker network ${dockerNetworkName}: ${networkCreate.stderr}`
      )
    }

    const leafPlans = [
      { label: 'a', kind: 'stem' as const },
      { label: 'b', kind: 'leaf' as const }
    ]
    for (const leafPlan of leafPlans) {
      const leafName = `mnet-harness-leaf-${leafPlan.label}-${startedAt}`
      const containerName = `meristem-mnet-leaf-${leafPlan.label}-${startedAt}`
      const joinTicket = await createNodeJoinTicket(operatorToken, leafName, leafPlan.kind)
      const started = run([
        'docker',
        'run',
        '-d',
        '--cap-add',
        'NET_ADMIN',
        '--name',
        containerName,
        '--network',
        dockerNetworkName,
        '--add-host',
        'host.docker.internal:host-gateway',
        '-w',
        '/workspace',
        '-v',
        `${rootDir}:/workspace`,
        '-v',
        `${hostSystemBinDir}:${hostSystemBinDir}:ro`,
        '-v',
        '/nix/store:/nix/store:ro',
        '-e',
        `MERISTEM_JOIN_URL=wss://host.docker.internal:8443/join/v0/session`,
        '-e',
        `MERISTEM_MNET_CONTROL_URL=${controlMnetUrl}`,
        '-e',
        `MERISTEM_JOIN_TICKET=${joinTicket}`,
        '-e',
        `MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS=500`,
        '-e',
        `MERISTEM_RELAY_ENDPOINT=wss://host.docker.internal:${relayPort}`,
        '-e',
        `MERISTEM_WSTUNNEL_BINARY_PATH=${hostSystemBinDir}/wstunnel`,
        '-e',
        `MERISTEM_WG_BINARY_PATH=${hostSystemBinDir}/wg`,
        '-e',
        `PATH=${containerPath}`,
        '-e',
        'NODE_TLS_REJECT_UNAUTHORIZED=0',
        dockerImage,
        'sh',
        '-lc',
        `${hostSystemBinDir}/wstunnel client -L udp://127.0.0.1:51821:localhost:51820 -P ${relayPathPrefix} --log-lvl INFO "$MERISTEM_RELAY_ENDPOINT" & exec bun run services/node-agent/src/index.ts`
      ])
      if (started.exitCode !== 0 || started.stdout.length === 0) {
        throw new Error(`failed to start ${containerName}: ${started.stderr || started.stdout}`)
      }
      const logFile = join(logDir, `${containerName}.log`)
      leafStates.push({
        containerName,
        leafName,
        logFile,
        logPid: dockerLeafLogFollower(containerName, logFile)
      })
    }

    const state: HarnessState = {
      dockerImage,
      dockerNetworkName,
      infraWasRunning,
      leafs: leafStates,
      operatorToken,
      relay: {
        healthUrl: `http://127.0.0.1:${relayHealthPort}/health`,
        logFile: relayLogFile,
        pid: relayPid,
        relayEndpoint: `wss://host.docker.internal:${relayPort}`
      },
      services: serviceProcesses,
      startedAt: new Date(startedAt).toISOString()
    }
    writeJson(stateFile, state)

    await waitFor('leaf agent readiness', async () => {
      const status = await readHarnessStatus()
      return (
        status.active &&
        status.leafs.length === 2 &&
        status.leafs.every(leaf => leaf.status === 'healthy')
      )
    })

    const readyStatus = await readHarnessStatus()
    const activeLeafIds = readyStatus.leafs.flatMap(leaf => (leaf.id ? [leaf.id] : []))
    const network = await createHarnessNetwork(activeLeafIds)
    await enableDataPlaneProfileFor(network.id)

    return await readHarnessStatus()
  } catch (error) {
    for (const leaf of leafStates) {
      killPid(leaf.logPid)
      run(['docker', 'rm', '-f', leaf.containerName])
    }
    if (dockerNetworkName) {
      run(['docker', 'network', 'rm', dockerNetworkName])
    }
    if (relayPid !== null) {
      killPid(relayPid)
    }
    for (const service of [...serviceProcesses].reverse()) {
      killPid(service.pid)
    }
    cleanupHarnessOrphans()
    rmSync(stateFile, { force: true })
    throw error
  }
}

export function loadState(): HarnessState | null {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as HarnessState
  } catch {
    return null
  }
}

function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGINT')
  } catch {
    // 这里允许进程已经退出，清理动作继续执行。
  }
}

function listMatchingPids(fragment: string): number[] {
  const result = run(['ps', '-eo', 'pid,args'])
  if (result.exitCode !== 0 || result.stdout.length === 0) return []

  return result.stdout.split('\n').flatMap(line => {
    if (!line.includes(fragment)) return []
    const trimmed = line.trim()
    if (trimmed.length === 0) return []
    const [pidText] = trimmed.split(/\s+/, 1)
    const pid = Number(pidText)
    return Number.isInteger(pid) ? [pid] : []
  })
}

function killMatchingProcesses(fragment: string): void {
  for (const pid of listMatchingPids(fragment)) {
    killPid(pid)
  }
}

function cleanupHarnessContainers(): void {
  const result = run(['docker', 'ps', '-aq', '--filter', 'name=meristem-mnet-leaf-'])
  if (result.exitCode !== 0 || result.stdout.length === 0) return
  for (const containerId of result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)) {
    run(['docker', 'rm', '-f', containerId])
  }
}

function cleanupHarnessNetworks(): void {
  const result = run(['docker', 'network', 'ls', '--format', '{{.Name}}'])
  if (result.exitCode !== 0 || result.stdout.length === 0) return
  for (const networkName of result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)) {
    if (!networkName.startsWith('meristem-mnet-harness-')) continue
    run(['docker', 'network', 'rm', networkName])
  }
}

function cleanupHarnessOrphans(): void {
  cleanupHarnessContainers()
  cleanupHarnessNetworks()
  killMatchingProcesses('docker logs -f meristem-mnet-leaf-')
  killMatchingProcesses('scripts/mnet-multihost-relay.ts')
  killMatchingProcesses('/run/current-system/sw/bin/wstunnel server')
  for (const service of coreServiceCommands) {
    const entrypoint = service.command[2]
    if (entrypoint) killMatchingProcesses(entrypoint)
  }
}

export async function stopTopology(removeInfra = false): Promise<void> {
  const state = loadState()
  if (!state) {
    cleanupHarnessOrphans()
    return
  }

  for (const leaf of state.leafs) {
    killPid(leaf.logPid)
    run(['docker', 'rm', '-f', leaf.containerName])
  }

  run(['docker', 'network', 'rm', state.dockerNetworkName])
  killPid(state.relay.pid)

  for (const service of [...state.services].reverse()) {
    killPid(service.pid)
  }

  if (removeInfra && !state.infraWasRunning) {
    run(['docker', 'compose', 'down'])
  }

  cleanupHarnessOrphans()
  rmSync(stateFile, { force: true })
}

export async function resetTopology(): Promise<void> {
  await stopTopology(true)
  rmSync(harnessDir, { force: true, recursive: true })
}

export async function readHarnessStatus(): Promise<HarnessStatus> {
  const state = loadState()
  if (!state) {
    return {
      active: false,
      controlPlane: { ready: false, url: controlReadyUrl },
      issue: {
        ok: false,
        code: 'harness.not_started',
        message: 'multi-host harness state is absent',
        hint: 'Run bun run mnet:harness:start before requesting harness status.'
      },
      leafs: [],
      logFiles: [],
      relay: { endpoint: null, healthUrl: null, ready: false }
    }
  }

  let controlReady = false
  try {
    const ready = await fetchJson(controlReadyUrl)
    controlReady = Boolean(
      ready && typeof ready === 'object' && 'ready' in ready && ready.ready === true
    )
  } catch {
    controlReady = false
  }

  let relayReady = false
  const relayProcessAlive = isPidAlive(state.relay.pid)
  try {
    const relayResponse = await fetch(state.relay.healthUrl)
    relayReady = relayProcessAlive && relayResponse.ok
  } catch {
    relayReady = false
  }

  const serviceProcessesAlive = state.services.every(service => isPidAlive(service.pid))

  let nodeRecords: readonly NodeRecord[] = []
  try {
    const nodes = await fetchJson(nodeListUrl, {
      headers: { authorization: `Bearer ${state.operatorToken}` }
    })
    nodeRecords = toNodeRecords(nodes)
  } catch {
    nodeRecords = []
  }

  const leafs = state.leafs.map(leaf => {
    const found = nodeRecords.find(node => node.name === leaf.leafName)
    return {
      found: found !== undefined,
      id: found?.id ?? null,
      kind: found?.kind ?? null,
      leafName: leaf.leafName,
      logFile: leaf.logFile,
      status: found?.status ?? null
    }
  })

  return {
    active: relayProcessAlive && serviceProcessesAlive,
    controlPlane: {
      ready: controlReady,
      url: controlReadyUrl
    },
    leafs,
    logFiles: [
      state.relay.logFile,
      ...state.services.map(service => service.logFile),
      ...state.leafs.map(leaf => leaf.logFile)
    ],
    relay: {
      endpoint: state.relay.relayEndpoint,
      healthUrl: state.relay.healthUrl,
      ready: relayReady
    }
  }
}
