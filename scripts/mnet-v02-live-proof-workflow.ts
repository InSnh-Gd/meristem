import type {
  MNetV02LiveProofReport,
  PacketReachabilityEvidence,
  StartedNodeAgent
} from './mnet-v02-live-proof-contract.ts'
import { type LiveProofDeps, liveProofRuntime } from './mnet-v02-live-proof-runtime.ts'

const {
  capabilityFailures,
  createJoinTicket,
  createProofNetwork,
  defaultDeps,
  enableProofProfile,
  failure,
  finalizeReport,
  joinProofNetwork,
  parseFlag,
  prerequisiteMissing,
  success
} = liveProofRuntime

/** 执行三主机 Keycloak 与 NetBird 数据包可达性证明，并返回完整 release 报告。 */
export async function runMNetV02LiveProof(
  input: { readonly argv?: readonly string[] } = {},
  overrideDeps: Partial<LiveProofDeps> = {}
): Promise<MNetV02LiveProofReport> {
  const argv = input.argv ?? process.argv
  const results = [] as MNetV02LiveProofReport['results'][number][]
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
    const result =
      deployProof.verdict === 'prerequisite-missing'
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

  const probe = capabilities.tcpProbe ? 'tcp' : 'icmp'
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
