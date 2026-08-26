import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { internalTokenHeaderName } from '../packages/internal-http/src/index.ts'
import {
  coreServiceCommands,
  prepareInfra,
  prepareWorkspace,
  rootDir
} from './local-stack-runtime.ts'
import type {
  HarnessLeafState,
  HarnessServiceProcess,
  HarnessState,
  HarnessStatus
} from './mnet-multihost-harness-contract.ts'
import { runPreflightChecks } from './mnet-multihost-harness-preflight.ts'
import { harnessRuntime } from './mnet-multihost-harness-runtime.ts'
import { readHarnessStatus } from './mnet-multihost-harness-status.ts'

const {
  containerPath,
  controlCoreUrl,
  controlMnetUrl,
  dockerImage,
  dockerLeafLogFollower,
  ensureHarnessDirs,
  fetchJson,
  harnessDir,
  harnessEnv,
  hostSystemBinDir,
  infraAlreadyRunning,
  loadState: readState,
  logDir,
  mNetInternalUrl,
  relayHealthPort,
  relayPathPrefix,
  relayPort,
  run,
  sanitizeLabel,
  startDetached,
  stateFile,
  waitFor,
  writeJson,
  isPidAlive
} = harnessRuntime

type CreatedHarnessNetwork = { readonly id: string }

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
    headers: { 'content-type': 'application/json', [internalTokenHeaderName]: internalToken },
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
        headers: { 'content-type': 'application/json', [internalTokenHeaderName]: internalToken },
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
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
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
          { headers: { [internalTokenHeaderName]: process.env.MERISTEM_INTERNAL_TOKEN ?? '' } }
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
      { headers: { [internalTokenHeaderName]: process.env.MERISTEM_INTERNAL_TOKEN ?? '' } }
    )
    return mapResponse.ok
  })
}

async function createNodeJoinTicket(
  operatorToken: string,
  nodeName: string,
  kind: 'stem' | 'leaf'
): Promise<string> {
  const response = await fetch(`${controlCoreUrl}/api/v0/node-tickets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind, name: nodeName })
  })
  if (!response.ok)
    throw new Error(`failed to create join ticket for ${nodeName}: ${response.status}`)
  const body = await response.json()
  if (!body || typeof body !== 'object' || !('ticket' in body) || typeof body.ticket !== 'string') {
    throw new Error(`join ticket response for ${nodeName} did not include a ticket string`)
  }
  return body.ticket
}

/** 启动控制面、Relay 与两个隔离 Leaf，并完成 M-Net 数据面启用。 */
export async function startTopology(): Promise<HarnessStatus> {
  ensureHarnessDirs()
  const preflight = await runPreflightChecks()
  if (!preflight.ok) {
    return {
      active: false,
      controlPlane: { ready: false, url: `${controlCoreUrl}/api/v0/ready` },
      issue: preflight,
      leafs: [],
      logFiles: [],
      relay: { endpoint: null, healthUrl: null, ready: false }
    }
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
        const body = await fetchJson(`${controlCoreUrl}/api/v0/ready`)
        return Boolean(body && typeof body === 'object' && 'ready' in body && body.ready === true)
      } catch {
        return false
      }
    })
    await waitFor('relay health', async () => {
      if (relayPid === null || !isPidAlive(relayPid)) return false
      try {
        return (await fetch(`http://127.0.0.1:${relayHealthPort}/health`)).ok
      } catch {
        return false
      }
    })
    const operatorToken = process.env.MERISTEM_TOKEN
    if (!operatorToken)
      throw new Error('prepareWorkspace did not yield MERISTEM_TOKEN for harness startup')

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
        'MERISTEM_JOIN_URL=wss://host.docker.internal:8443/join/v0/session',
        '-e',
        `MERISTEM_MNET_CONTROL_URL=${controlMnetUrl}`,
        '-e',
        `MERISTEM_JOIN_TICKET=${joinTicket}`,
        '-e',
        'MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS=500',
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
    if (dockerNetworkName) run(['docker', 'network', 'rm', dockerNetworkName])
    if (relayPid !== null) killPid(relayPid)
    for (const service of [...serviceProcesses].reverse()) killPid(service.pid)
    cleanupHarnessOrphans()
    rmSync(stateFile, { force: true })
    throw error
  }
}

/** 读取现有 Harness 状态，供兼容入口和生命周期清理共用。 */
export function loadState(): HarnessState | null {
  return readState()
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
  for (const pid of listMatchingPids(fragment)) killPid(pid)
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

/** 停止 Harness 管理的进程、容器与网络，并按需回收本次启动的基础设施。 */
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
  for (const service of [...state.services].reverse()) killPid(service.pid)
  if (removeInfra && !state.infraWasRunning) run(['docker', 'compose', 'down'])
  cleanupHarnessOrphans()
  rmSync(stateFile, { force: true })
}

/** 彻底移除 Harness 状态目录并回收其创建的运行资源。 */
export async function resetTopology(): Promise<void> {
  await stopTopology(true)
  rmSync(harnessDir, { force: true, recursive: true })
}
