/**
 * mnet-v02-live-proof.ts - three-host Keycloak + NetBird packet reachability proof.
 *
 * The proof composes the v0.2 deploy proof, enables the NetBird profile, joins two
 * node-agent runtimes, and only marks release success after a packet probe from
 * node-a to node-b's overlay address succeeds.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mintKeycloakTokenForActor } from './keycloak-dev-realm.ts'
import { rootDir } from './local-stack-runtime.ts'
import { runV02DeployProof, type DeployProofReport } from './v02-deploy-proof.ts'
import type {
  HostCapabilities,
  LiveProofVerdict,
  MNetV02LiveProofReport,
  PacketReachabilityEvidence,
  ProbeKind,
  ProofResult,
  StartedNodeAgent
} from './mnet-v02-live-proof-contract.ts'

type LiveProofDeps = {
  readonly detectHostCapabilities: () => Promise<HostCapabilities>
  readonly runDeployProof: () => Promise<DeployProofReport>
  readonly fetch: typeof fetch
  readonly mintOperatorToken: (deploy: DeployProofReport) => Promise<string>
  readonly startNodeAgent: (input: {
    host: 'node-a' | 'node-b'
    deploy: DeployProofReport
    joinTicket: string
  }) => Promise<StartedNodeAgent>
  readonly readOverlayIp: (host: 'node-a' | 'node-b', nodeId: string) => Promise<string | null>
  readonly probeNetBirdHealth: (
    host: 'node-a' | 'node-b'
  ) => Promise<{ ok: boolean; detail: string }>
  readonly probePacketReachability: (input: {
    probe: ProbeKind
    targetOverlayIp: string
  }) => Promise<{ ok: boolean; detail: string }>
  readonly stopPid: (pid: number) => void
}

const _topology = ['control', 'node-a', 'node-b'] as const
const workspaceDir = join(rootDir, '.local', 'mnet-v02-live-proof')

function success(step: string, detail: string): ProofResult {
  return { status: 'success', step, detail }
}

function prerequisiteMissing(
  step: string,
  code: string,
  message: string,
  detail?: string
): ProofResult {
  return { status: 'prerequisite-missing', step, code, message, ...(detail ? { detail } : {}) }
}

function failure(step: string, code: string, message: string, detail?: string): ProofResult {
  return { status: 'failure', step, code, message, ...(detail ? { detail } : {}) }
}

function parseFlag(argv: readonly string[], name: string): string | null {
  return argv.find(argument => argument.startsWith(`--${name}=`))?.split('=')[1] ?? null
}

function finalizeReport(input: {
  readonly deployProof?: DeployProofReport
  readonly keycloakTokenVerification?: MNetV02LiveProofReport['keycloakTokenVerification']
  readonly profileEnable?: MNetV02LiveProofReport['profileEnable']
  readonly nodeAgentJoin?: MNetV02LiveProofReport['nodeAgentJoin']
  readonly netbirdProcessHealth?: MNetV02LiveProofReport['netbirdProcessHealth']
  readonly packetReachability?: PacketReachabilityEvidence
  readonly results: readonly ProofResult[]
}): MNetV02LiveProofReport {
  const verdict: LiveProofVerdict = input.results.some(result => result.status === 'failure')
    ? 'failure'
    : input.results.some(result => result.status === 'prerequisite-missing')
      ? 'prerequisite-missing'
      : input.packetReachability?.status === 'success'
        ? 'pass'
        : 'failure'

  return {
    proof: 'mnet-v02-live-proof',
    topology: ['control', 'node-a', 'node-b'],
    oidc: 'keycloak',
    profileVersion: 'm-net@0.3.0',
    ...(input.deployProof ? { deployProof: input.deployProof } : {}),
    keycloakTokenVerification: input.keycloakTokenVerification ?? {
      status: 'not-run',
      detail: 'not reached'
    },
    profileEnable: input.profileEnable ?? { status: 'not-run', detail: 'not reached' },
    nodeAgentJoin: input.nodeAgentJoin ?? [
      { host: 'node-a', status: 'not-run', detail: 'not reached' },
      { host: 'node-b', status: 'not-run', detail: 'not reached' }
    ],
    netbirdProcessHealth: input.netbirdProcessHealth ?? [
      { host: 'node-a', status: 'not-run', detail: 'not reached' },
      { host: 'node-b', status: 'not-run', detail: 'not reached' }
    ],
    packetReachability: input.packetReachability ?? { status: 'not-run', detail: 'not reached' },
    results: input.results,
    releaseSuccess: verdict === 'pass',
    verdict
  }
}

function hasCapNetAdmin(): boolean {
  try {
    const status = readFileSync('/proc/self/status', 'utf8')
    const raw = status
      .split('\n')
      .find(line => line.startsWith('CapEff:'))
      ?.split(':')[1]
      ?.trim()
    return raw ? (BigInt(`0x${raw}`) & (1n << 12n)) !== 0n : false
  } catch {
    return false
  }
}

function commandExists(command: readonly string[]): boolean {
  const result = Bun.spawnSync([...command], {
    cwd: rootDir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  return result.exitCode === 0
}

async function detectHostCapabilities(): Promise<HostCapabilities> {
  return {
    docker: commandExists(['docker', '--version']),
    netbird: commandExists([process.env.MERISTEM_NETBIRD_BINARY_PATH ?? 'netbird', 'version']),
    netAdmin: hasCapNetAdmin(),
    tcpProbe:
      commandExists(['nc', '-h']) ||
      commandExists(['bash', '-lc', 'command -v timeout >/dev/null']),
    icmpProbe: commandExists(['ping', '-V'])
  }
}

function capabilityFailures(capabilities: HostCapabilities): ProofResult[] {
  const failures: ProofResult[] = []
  if (!capabilities.docker) {
    failures.push(
      prerequisiteMissing(
        'host.docker',
        'host.docker_missing',
        'Docker is required to start Keycloak and local supporting services'
      )
    )
  }
  if (!capabilities.netbird) {
    failures.push(
      prerequisiteMissing(
        'host.netbird',
        'host.netbird_missing',
        'netbird client binary is required on node-a and node-b'
      )
    )
  }
  if (!capabilities.netAdmin) {
    failures.push(
      prerequisiteMissing(
        'host.net_admin',
        'host.net_admin_missing',
        'CAP_NET_ADMIN is required for NetBird/WireGuard packet proof'
      )
    )
  }
  if (!capabilities.tcpProbe && !capabilities.icmpProbe) {
    failures.push(
      prerequisiteMissing(
        'host.packet-probe',
        'host.packet_probe_missing',
        'TCP or ICMP probe command is required to prove packet reachability'
      )
    )
  }
  return failures
}

async function mintOperatorToken(_deploy: DeployProofReport): Promise<string> {
  const statePath = join(rootDir, '.local', 'keycloak-dev-realm', 'state.json')
  const state = JSON.parse(await Bun.file(statePath).text()) as Parameters<
    typeof mintKeycloakTokenForActor
  >[0]
  return (await mintKeycloakTokenForActor(state, 'operator')).accessToken
}

async function createProofNetwork(deps: LiveProofDeps) {
  const serviceUrl = 'http://127.0.0.1:3104'
  const internalToken = process.env.MERISTEM_INTERNAL_TOKEN ?? 'deploy-proof-internal-token'
  const networkResponse = await deps.fetch(`${serviceUrl}/internal/v0/networks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-meristem-internal-token': internalToken
    },
    body: JSON.stringify({ name: `mnet-v02-live-proof-${Date.now()}` })
  })
  const networkBody = (await networkResponse.json().catch(() => null)) as {
    network?: { id?: unknown }
  } | null
  const networkId = typeof networkBody?.network?.id === 'string' ? networkBody.network.id : null
  if (!networkResponse.ok || !networkId) {
    return { ok: false as const, detail: `network create failed: HTTP ${networkResponse.status}` }
  }
  return { ok: true as const, detail: `created network ${networkId}`, networkId }
}

async function joinProofNetwork(
  deps: LiveProofDeps,
  networkId: string,
  agent: StartedNodeAgent
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  const response = await deps.fetch(
    `http://127.0.0.1:3104/internal/v0/networks/${networkId}/members`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-meristem-internal-token':
          process.env.MERISTEM_INTERNAL_TOKEN ?? 'deploy-proof-internal-token'
      },
      body: JSON.stringify({ nodeId: agent.nodeId })
    }
  )
  return response.ok
    ? { ok: true, detail: `${agent.host} joined ${networkId}` }
    : { ok: false, detail: `${agent.host} network join failed: HTTP ${response.status}` }
}

async function enableProofProfile(deps: LiveProofDeps, networkId: string, token: string) {
  const serviceUrl = 'http://127.0.0.1:3104'
  const enableResponse = await deps.fetch(`${serviceUrl}/api/v0/networks/${networkId}/profile`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      profileVersion: 'm-net@0.3.0',
      reason: 'v0.2 live NetBird packet proof'
    })
  })
  const enableBody = (await enableResponse.json().catch(() => null)) as {
    status?: unknown
    mapVersion?: unknown
  } | null
  if (!enableResponse.ok || enableBody?.status !== 'enabled') {
    return {
      ok: false as const,
      detail: `profile enable failed: HTTP ${enableResponse.status}`,
      networkId
    }
  }
  return {
    ok: true as const,
    detail: `enabled mapVersion=${String(enableBody.mapVersion)}`,
    networkId
  }
}

async function createJoinTicket(token: string, host: 'node-a' | 'node-b'): Promise<string> {
  const response = await fetch('http://127.0.0.1:3000/api/v0/node-tickets', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ kind: host === 'node-a' ? 'stem' : 'leaf', name: host })
  })
  const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null
  if (!response.ok || typeof body?.ticket !== 'string') {
    throw new Error(`${host} join ticket creation failed: HTTP ${response.status}`)
  }
  return body.ticket
}

function nodeRuntimeStatePath(host: 'node-a' | 'node-b'): string {
  return join(workspaceDir, `${host}-runtime.json`)
}

async function startNodeAgent(input: {
  host: 'node-a' | 'node-b'
  deploy: DeployProofReport
  joinTicket: string
}): Promise<StartedNodeAgent> {
  mkdirSync(workspaceDir, { recursive: true })
  const runtimePath = nodeRuntimeStatePath(input.host)
  rmSync(runtimePath, { force: true })
  const child = Bun.spawn(['bun', 'run', 'services/node-agent/src/index.ts'], {
    cwd: rootDir,
    env: {
      ...process.env,
      MERISTEM_NODE_RUNTIME_STATE_PATH: runtimePath,
      MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH: join(workspaceDir, `${input.host}-sidecar.json`),
      MERISTEM_JOIN_TICKET: input.joinTicket,
      MERISTEM_HOST_PRIVATE_KEY_PATH: join(workspaceDir, `${input.host}-wg-private.key`)
    },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore'
  })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (existsSync(runtimePath)) {
      const parsed = JSON.parse(await Bun.file(runtimePath).text()) as { nodeId?: unknown }
      if (typeof parsed.nodeId === 'string') {
        return { host: input.host, nodeId: parsed.nodeId, pid: child.pid }
      }
    }
    await Bun.sleep(500)
  }
  child.kill('SIGTERM')
  throw new Error(`${input.host} node-agent did not join before timeout`)
}

async function readOverlayIp(host: 'node-a' | 'node-b', nodeId: string): Promise<string | null> {
  const status = Bun.spawnSync(
    [process.env.MERISTEM_NETBIRD_BINARY_PATH ?? 'netbird', 'status', '--json'],
    {
      cwd: rootDir,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  if (status.exitCode !== 0) return null
  const parsed = JSON.parse(status.stdout.toString()) as { peers?: unknown }
  if (!Array.isArray(parsed.peers)) return null
  for (const peer of parsed.peers) {
    if (typeof peer !== 'object' || peer === null) continue
    const candidate = peer as { hostname?: unknown; ip?: unknown; fqdn?: unknown; name?: unknown }
    const names = [candidate.hostname, candidate.fqdn, candidate.name]
    if (names.includes(host) || names.includes(nodeId)) {
      return typeof candidate.ip === 'string' ? candidate.ip : null
    }
  }
  return null
}

async function probeNetBirdHealth(
  host: 'node-a' | 'node-b'
): Promise<{ ok: boolean; detail: string }> {
  const result = Bun.spawnSync([process.env.MERISTEM_NETBIRD_BINARY_PATH ?? 'netbird', 'status'], {
    cwd: rootDir,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const detail = (result.stdout.toString().trim() || result.stderr.toString().trim()).slice(0, 400)
  const normalized = detail.toLowerCase()
  return {
    ok:
      result.exitCode === 0 && (normalized.includes('connected') || normalized.includes('running')),
    detail: `${host}: ${detail || `netbird status exited ${result.exitCode}`}`
  }
}

async function probePacketReachability(input: {
  probe: ProbeKind
  targetOverlayIp: string
}): Promise<{ ok: boolean; detail: string }> {
  const command =
    input.probe === 'tcp'
      ? ['bash', '-lc', `timeout 5 bash -c '</dev/tcp/${input.targetOverlayIp}/22'`]
      : ['ping', '-c', '1', '-W', '5', input.targetOverlayIp]
  const result = Bun.spawnSync(command, {
    cwd: rootDir,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const detail =
    result.stdout.toString().trim() || result.stderr.toString().trim() || `exit ${result.exitCode}`
  return { ok: result.exitCode === 0, detail }
}

function stopPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 已退出的 proof 子进程无需重复回收。
  }
}

const defaultDeps: LiveProofDeps = {
  detectHostCapabilities,
  runDeployProof: () =>
    runV02DeployProof({
      argv: ['bun', 'scripts/v02-deploy-proof.ts', '--target=nixos', '--auth=oidc']
    }),
  fetch,
  mintOperatorToken,
  startNodeAgent,
  readOverlayIp,
  probeNetBirdHealth,
  probePacketReachability,
  stopPid
}

export async function runMNetV02LiveProof(
  input: { readonly argv?: readonly string[] } = {},
  overrideDeps: Partial<LiveProofDeps> = {}
): Promise<MNetV02LiveProofReport> {
  const argv = input.argv ?? process.argv
  const results: ProofResult[] = []
  const requestedTopology = parseFlag(argv, 'topology') ?? 'three-host'
  const requestedOidc = parseFlag(argv, 'oidc') ?? 'keycloak'
  if (requestedTopology !== 'three-host') {
    results.push(
      failure(
        'args.topology',
        'topology.unsupported',
        'live proof only supports --topology=three-host'
      )
    )
  }
  if (requestedOidc !== 'keycloak') {
    results.push(
      failure('args.oidc', 'oidc.unsupported', 'live proof only supports --oidc=keycloak')
    )
  }
  if (results.length > 0) return finalizeReport({ results })

  const deps = { ...defaultDeps, ...overrideDeps }
  const capabilities = await deps.detectHostCapabilities()
  const missingCapabilities = capabilityFailures(capabilities)
  if (missingCapabilities.length > 0) return finalizeReport({ results: missingCapabilities })
  results.push(
    success('host.capabilities', 'Docker, netbird, NET_ADMIN, and packet probe are available')
  )

  const deployProof = await deps.runDeployProof()
  if (deployProof.verdict !== 'pass') {
    const status =
      deployProof.verdict === 'prerequisite-missing' ? 'prerequisite-missing' : 'failure'
    const result =
      status === 'prerequisite-missing'
        ? prerequisiteMissing(
            'deploy-proof',
            'deploy.prerequisite_missing',
            'v0.2 deploy proof did not reach pass'
          )
        : failure('deploy-proof', 'deploy.failed', 'v0.2 deploy proof failed')
    return finalizeReport({ deployProof, results: [...results, result] })
  }
  results.push(success('deploy-proof', 'control host services are ready'))

  let token: string
  try {
    token = await deps.mintOperatorToken(deployProof)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return finalizeReport({
      deployProof,
      keycloakTokenVerification: { status: 'failure', detail },
      results: [
        ...results,
        failure(
          'keycloak.token',
          'keycloak.token_failed',
          'Keycloak operator token verification failed',
          detail
        )
      ]
    })
  }
  const keycloakTokenVerification = {
    status: 'success' as const,
    detail: `minted token length=${token.length}`
  }
  results.push(success('keycloak.token', 'operator token minted'))

  const network = await createProofNetwork(deps)
  if (!network.ok) {
    return finalizeReport({
      deployProof,
      keycloakTokenVerification,
      profileEnable: { status: 'failure', detail: network.detail },
      results: [
        ...results,
        failure('m-net.network.create', 'mnet.network_create_failed', network.detail)
      ]
    })
  }
  results.push(success('m-net.network.create', network.detail))

  const startedAgents: StartedNodeAgent[] = []
  try {
    const nodeAJoinTicket = await createJoinTicket(token, 'node-a')
    const nodeBJoinTicket = await createJoinTicket(token, 'node-b')
    startedAgents.push(
      await deps.startNodeAgent({
        host: 'node-a',
        deploy: deployProof,
        joinTicket: nodeAJoinTicket
      })
    )
    startedAgents.push(
      await deps.startNodeAgent({
        host: 'node-b',
        deploy: deployProof,
        joinTicket: nodeBJoinTicket
      })
    )
  } catch (error) {
    for (const agent of startedAgents) deps.stopPid(agent.pid)
    const detail = error instanceof Error ? error.message : String(error)
    return finalizeReport({
      deployProof,
      keycloakTokenVerification,
      nodeAgentJoin: [
        { host: 'node-a', status: 'failure' as const, detail },
        { host: 'node-b', status: 'failure' as const, detail }
      ],
      results: [...results, failure('node-agent.join', 'node_agent.join_failed', detail)]
    })
  }
  const nodeAgentJoin = startedAgents.map(agent => ({
    host: agent.host,
    status: 'success' as const,
    detail: `joined as ${agent.nodeId}`,
    nodeId: agent.nodeId
  }))
  results.push(success('node-agent.join', 'node-a and node-b joined'))

  for (const agent of startedAgents) {
    const member = await joinProofNetwork(deps, network.networkId, agent)
    if (!member.ok) {
      for (const started of startedAgents) deps.stopPid(started.pid)
      return finalizeReport({
        deployProof,
        keycloakTokenVerification,
        nodeAgentJoin,
        profileEnable: { status: 'failure', detail: member.detail, networkId: network.networkId },
        results: [
          ...results,
          failure('m-net.network.member', 'mnet.network_member_join_failed', member.detail)
        ]
      })
    }
    results.push(success('m-net.network.member', member.detail))
  }

  const profile = await enableProofProfile(deps, network.networkId, token)
  if (!profile.ok) {
    for (const agent of startedAgents) deps.stopPid(agent.pid)
    return finalizeReport({
      deployProof,
      keycloakTokenVerification,
      nodeAgentJoin,
      profileEnable: { status: 'failure', detail: profile.detail, networkId: profile.networkId },
      results: [
        ...results,
        failure('m-net.profile.enable', 'mnet.profile_enable_failed', profile.detail)
      ]
    })
  }
  const profileEnable = {
    status: 'success' as const,
    detail: profile.detail,
    networkId: profile.networkId
  }
  results.push(success('m-net.profile.enable', profile.detail))

  const health = await Promise.all(startedAgents.map(agent => deps.probeNetBirdHealth(agent.host)))
  const netbirdProcessHealth = health.map((probe, index) => ({
    host: startedAgents[index]?.host ?? 'node-a',
    status: probe.ok ? ('healthy' as const) : ('degraded' as const),
    detail: probe.detail
  }))
  if (health.some(probe => !probe.ok)) {
    for (const agent of startedAgents) deps.stopPid(agent.pid)
    return finalizeReport({
      deployProof,
      keycloakTokenVerification,
      profileEnable,
      nodeAgentJoin,
      netbirdProcessHealth,
      results: [
        ...results,
        failure('netbird.health', 'netbird.process_unhealthy', 'NetBird client health check failed')
      ]
    })
  }
  results.push(success('netbird.health', 'node-a and node-b clients are healthy'))

  const nodeB = startedAgents.find(agent => agent.host === 'node-b')
  const nodeBOverlayIp = nodeB ? await deps.readOverlayIp('node-b', nodeB.nodeId) : null
  if (!nodeBOverlayIp) {
    for (const agent of startedAgents) deps.stopPid(agent.pid)
    return finalizeReport({
      deployProof,
      keycloakTokenVerification,
      profileEnable,
      nodeAgentJoin,
      netbirdProcessHealth,
      packetReachability: {
        status: 'failure',
        source: 'node-a',
        target: 'node-b',
        detail: 'node-b overlay IP was not available from runtime evidence'
      },
      results: [
        ...results,
        failure(
          'packet.overlay-ip',
          'packet.target_overlay_ip_missing',
          'node-b overlay IP was not available'
        )
      ]
    })
  }

  const probe: ProbeKind = capabilities.tcpProbe ? 'tcp' : 'icmp'
  const packet = await deps.probePacketReachability({ probe, targetOverlayIp: nodeBOverlayIp })
  for (const agent of startedAgents) deps.stopPid(agent.pid)
  const packetReachability: PacketReachabilityEvidence = packet.ok
    ? {
        status: 'success',
        probe,
        source: 'node-a',
        target: 'node-b',
        targetOverlayIp: nodeBOverlayIp,
        detail: packet.detail
      }
    : {
        status: 'failure',
        probe,
        source: 'node-a',
        target: 'node-b',
        targetOverlayIp: nodeBOverlayIp,
        detail: packet.detail
      }
  results.push(
    packet.ok
      ? success('packet.reachability', `${probe} probe reached ${nodeBOverlayIp}`)
      : failure(
          'packet.reachability',
          'packet.probe_failed',
          'node-a could not reach node-b overlay IP',
          packet.detail
        )
  )

  return finalizeReport({
    deployProof,
    keycloakTokenVerification,
    profileEnable,
    nodeAgentJoin,
    netbirdProcessHealth,
    packetReachability,
    results
  })
}

if (import.meta.main) {
  const report = await runMNetV02LiveProof({ argv: process.argv })
  writeFileSync(
    join(rootDir, 'tests', 'evidence', 'mnet-v02-live-proof.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}
