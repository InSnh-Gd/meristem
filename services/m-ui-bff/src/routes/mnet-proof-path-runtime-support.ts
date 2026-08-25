import type {
  BffOperationalRuntimeTruthFromSchema,
  DisabledCommandExplanationFromSchema as DisabledCommandExplanation,
  MNetOperationalSnapshotFromSchema,
  Permission,
  PolicyDecisionFromSchema
} from '../../../../packages/contracts/src/index.ts'

type StateSource = BffOperationalRuntimeTruthFromSchema['auth']['stateSource']

type RuntimeTruthInput = {
  snapshot: MNetOperationalSnapshotFromSchema
  permissions: readonly Permission[]
  policyDecision?: PolicyDecisionFromSchema
}

type NetbirdRuntimeNode = BffOperationalRuntimeTruthFromSchema['netbirdProcess']['nodes'][number]

type OptionalLiveProof = {
  authMode?: MNetOperationalSnapshotFromSchema['authMode']
  netbirdProcessHealth?: MNetOperationalSnapshotFromSchema['netbirdProcessHealth']
  packetReachability?: MNetOperationalSnapshotFromSchema['packetReachability']
}

const runtimeStateSource = (networkId: string, suffix: string): StateSource => ({
  sourceType: 'read-model',
  sourceId: `mnet:/api/v0/networks/${networkId}/operational-state#${suffix}`
})

const policyStateSource = (networkId: string): StateSource => ({
  sourceType: 'policy',
  sourceId: `m-policy:/internal/v0/authorize#network:${networkId}`
})

function liveProofFromSnapshot(snapshot: MNetOperationalSnapshotFromSchema): OptionalLiveProof {
  return {
    ...(snapshot.authMode ? { authMode: snapshot.authMode } : {}),
    ...(snapshot.netbirdProcessHealth
      ? { netbirdProcessHealth: snapshot.netbirdProcessHealth }
      : {}),
    ...(snapshot.packetReachability ? { packetReachability: snapshot.packetReachability } : {})
  }
}

function secretProviderStatus(
  snapshot: MNetOperationalSnapshotFromSchema
): BffOperationalRuntimeTruthFromSchema['secretProvider'] {
  const hasDeniedReason = snapshot.deploymentReadiness.reasons.some(reason =>
    reason.message.toLowerCase().includes('denied')
  )
  if (hasDeniedReason) {
    return {
      status: 'denied',
      summary: 'SecretProvider access is denied by upstream runtime facts',
      stateSource: runtimeStateSource(snapshot.networkId, 'credentials')
    }
  }

  const hasMissingCredential = snapshot.credentials.nodes.some(
    node => node.credentialStatus === 'missing'
  )
  if (hasMissingCredential) {
    return {
      status: 'missing',
      summary: 'SecretProvider has missing credential material for one or more nodes',
      stateSource: runtimeStateSource(snapshot.networkId, 'credentials')
    }
  }

  return {
    status: 'resolved',
    summary: snapshot.credentials.summary,
    stateSource: runtimeStateSource(snapshot.networkId, 'credentials')
  }
}

function observedProcessStatus(
  value: string | undefined
): 'running' | 'stopped' | 'not-run' | 'unknown' {
  if (value === 'healthy' || value === 'degraded') return 'running'
  if (value === 'not-run') return 'not-run'
  if (value === 'stopped') return 'stopped'
  return 'unknown'
}

function desiredProcessStatus(value: string | undefined): 'running' | 'stopped' | 'unknown' {
  if (value === 'running' || value === 'connected') return 'running'
  if (value === 'stopped' || value === 'disabled') return 'stopped'
  return 'unknown'
}

function netbirdProcess(
  snapshot: MNetOperationalSnapshotFromSchema,
  liveProof: OptionalLiveProof
): BffOperationalRuntimeTruthFromSchema['netbirdProcess'] {
  const proofNodes = liveProof.netbirdProcessHealth ?? []
  const nodes: NetbirdRuntimeNode[] =
    proofNodes.length > 0
      ? proofNodes.map((node, index) => {
          const observed = observedProcessStatus(node.status)
          const status: NetbirdRuntimeNode['status'] =
            node.status === 'healthy' ? 'healthy' : 'degraded'
          return {
            nodeId: node.nodeId ?? node.host ?? `netbird-host-${index + 1}`,
            desired: 'running' as const,
            observed,
            status,
            detail: node.detail ?? `NetBird process reported ${node.status ?? 'unknown'}`
          }
        })
      : snapshot.sidecars.map(node => {
          const desired = desiredProcessStatus(node.desiredState)
          const observed: NetbirdRuntimeNode['observed'] =
            node.adapterStatus === 'netbird' ? 'running' : 'unknown'
          const status: NetbirdRuntimeNode['status'] =
            node.healthStatus === 'healthy' && !node.stale ? 'healthy' : 'degraded'
          return {
            nodeId: node.nodeId,
            desired,
            observed,
            status,
            detail: node.summary
          }
        })

  const degraded = nodes.some(node => node.status === 'degraded')
  return {
    desired: nodes.every(node => node.desired === 'running') ? 'running' : 'unknown',
    observed: nodes.some(node => node.observed === 'running') ? 'running' : 'unknown',
    status: degraded ? 'degraded' : 'healthy',
    summary:
      nodes.length === 0
        ? 'No NetBird process health facts are available'
        : `${nodes.length} NetBird process runtime entries are visible`,
    nodes,
    stateSource: runtimeStateSource(snapshot.networkId, 'sidecars')
  }
}

function packetProof(
  snapshot: MNetOperationalSnapshotFromSchema,
  liveProof: OptionalLiveProof
): BffOperationalRuntimeTruthFromSchema['packetProof'] {
  const evidence = liveProof.packetReachability
  const status =
    evidence?.status === 'success' ||
    evidence?.status === 'failure' ||
    evidence?.status === 'not-run'
      ? evidence.status
      : 'not-run'
  return {
    status,
    summary: evidence?.detail ?? 'Packet reachability proof has not run for this network',
    ...(evidence?.source ? { source: evidence.source } : {}),
    ...(evidence?.target ? { target: evidence.target } : {}),
    ...(evidence?.probe ? { probe: evidence.probe } : {}),
    ...(evidence?.targetOverlayIp ? { targetOverlayIp: evidence.targetOverlayIp } : {}),
    stateSource: runtimeStateSource(snapshot.networkId, 'deploymentReadiness')
  }
}

function profileState(
  snapshot: MNetOperationalSnapshotFromSchema
): BffOperationalRuntimeTruthFromSchema['profile'] {
  if (snapshot.network.profileState === 'disabled') {
    return {
      state: 'disabled',
      reason: snapshot.network.summary,
      stateSource: runtimeStateSource(snapshot.networkId, 'network')
    }
  }
  if (snapshot.network.status === 'degraded' || snapshot.migrationRequired.required) {
    return {
      state: 'degraded',
      reason: snapshot.migrationRequired.required
        ? snapshot.migrationRequired.summary
        : snapshot.network.summary,
      stateSource: runtimeStateSource(snapshot.networkId, 'network')
    }
  }
  return {
    state: 'enabled',
    stateSource: runtimeStateSource(snapshot.networkId, 'network')
  }
}

function missingPermissionReason(permission: Permission): DisabledCommandExplanation {
  return {
    code: 'missing_permission',
    message: `缺少权限：${permission}`,
    missingPermission: permission
  }
}

function deniedPolicyReason(decision: PolicyDecisionFromSchema): DisabledCommandExplanation {
  return {
    code: 'missing_permission',
    message: decision.reasons[0] ?? 'M-Policy denied this repair command'
  }
}

function repairActions(
  input: RuntimeTruthInput
): BffOperationalRuntimeTruthFromSchema['repairActions'] {
  const commandId = 'network.forced-relay.change.execute'
  const permission: Permission = 'network:profile-enable'
  const source = input.policyDecision
    ? policyStateSource(input.snapshot.networkId)
    : runtimeStateSource(input.snapshot.networkId, 'policyEligibility')
  const disabledReason = !input.permissions.includes(permission)
    ? missingPermissionReason(permission)
    : input.policyDecision?.result === 'deny'
      ? deniedPolicyReason(input.policyDecision)
      : undefined

  return [
    {
      commandId,
      state: disabledReason ? 'disabled' : 'enabled',
      ...(disabledReason ? { disabledReason } : {}),
      stateSource: source
    }
  ]
}

/** 聚合 proof-path runtime truth；BFF 只派生展示态，不写入服务状态或复刻最终授权。 */
export function aggregateRuntimeTruth(
  input: RuntimeTruthInput
): BffOperationalRuntimeTruthFromSchema {
  const liveProof = liveProofFromSnapshot(input.snapshot)
  return {
    auth: {
      mode: liveProof.authMode ?? 'oidc',
      summary:
        liveProof.authMode === 'local-dev'
          ? 'Core session is backed by local-dev auth mode'
          : 'Core session is backed by OIDC bearer authentication',
      stateSource: {
        sourceType: 'authoritative',
        sourceId: 'core:/api/v0/session'
      }
    },
    secretProvider: secretProviderStatus(input.snapshot),
    netbirdProcess: netbirdProcess(input.snapshot, liveProof),
    packetProof: packetProof(input.snapshot, liveProof),
    profile: profileState(input.snapshot),
    repairActions: repairActions(input)
  }
}
