import type {
  MNetMigrationRequiredFromSchema,
  MNetOperationalEventIngestRequestFromSchema,
  MNetOperationalProfileVersionFromSchema,
  MNetOperationalSnapshotFromSchema,
  MNetworkMember
} from '../../../packages/contracts/src/index.ts'

export type EventSubject = MNetOperationalEventIngestRequestFromSchema['event']['subject']

export type ProjectionState = {
  lastSubject?: EventSubject
  lastEventId?: string
  lastEventAt?: string
  degradedReason?: {
    code: 'eventbus_unavailable'
    message: string
    subject: EventSubject
    observedAt: string
  }
  sidecarLifecycleByNode: Map<
    string,
    Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.sidecar.lifecycle.v0' }>['payload']
  >
  sidecarHealthByNode: Map<
    string,
    Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.sidecar.health.v0' }>['payload']
  >
  credentialByNode: Map<
    string,
    Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.credential.expiry.v0' }>['payload']
  >
  topology?: Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.topology.update.v0' }>['payload']
  migration?: Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.migration.required.v0' }>['payload']
  forcedRelay?: Extract<MNetOperationalEventIngestRequestFromSchema['event'], { subject: 'mnet.forced_relay.change.v0' }>['payload']
}

export type OperationalSnapshotFailure = {
  kind: 'failure'
  status: 404 | 503
  error: { code: string; message: string }
}

const STALE_REPORT_MS = 60_000

type Sidecars = MNetOperationalSnapshotFromSchema['sidecars']
type ReadinessReason = MNetOperationalSnapshotFromSchema['deploymentReadiness']['reasons'][number]

export function buildSidecars(
  members: readonly MNetworkMember[],
  profileVersion: MNetOperationalProfileVersionFromSchema,
  projection: ProjectionState,
  observedAt: Date
): Sidecars {
  const expectsSidecar =
    profileVersion === 'm-net@0.3.0' ||
    profileVersion === 'm-net-cn@0.3.0' ||
    projection.sidecarLifecycleByNode.size > 0 ||
    projection.sidecarHealthByNode.size > 0 ||
    projection.credentialByNode.size > 0
  if (!expectsSidecar) return []

  return members.map(member => {
    const lifecycle = projection.sidecarLifecycleByNode.get(member.nodeId)
    const health = projection.sidecarHealthByNode.get(member.nodeId)
    const credential = projection.credentialByNode.get(member.nodeId)
    const staleForMs = health?.checkedAt
      ? Math.max(0, observedAt.getTime() - Date.parse(health.checkedAt))
      : undefined
    const stale = staleForMs !== undefined && staleForMs > STALE_REPORT_MS
    const credentialStatus = credential?.credentialStatus ?? lifecycle?.credentialStatus ?? inferCredentialStatus({
      expectsSidecar,
      hasHealthReport: Boolean(health)
    })

    return {
      nodeId: member.nodeId,
      nodeKind: member.nodeKind,
      profileVersion: coerceProfileVersion(
        health?.profileVersion ?? credential?.profileVersion ?? lifecycle?.profileVersion ?? profileVersion
      ),
      ...(lifecycle ? { desiredState: lifecycle.desiredState } : {}),
      credentialStatus,
      ...(credential?.credentialRef ? { credentialRef: credential.credentialRef } : {}),
      ...(credential?.expiresAt ? { expiresAt: credential.expiresAt } : {}),
      healthStatus: health?.healthStatus ?? (expectsSidecar ? 'unknown' : 'healthy'),
      ...(health?.checkedAt ? { checkedAt: health.checkedAt } : {}),
      ...(health ? { signalReachable: health.signalReachable } : {}),
      ...(health ? { relayReachable: health.relayReachable } : {}),
      ...(health ? { stunReachable: health.stunReachable } : {}),
      stale,
      ...(staleForMs !== undefined ? { staleForMs } : {}),
      summary: summarizeSidecar(health?.healthStatus, credentialStatus, stale, lifecycle?.desiredState)
    }
  })
}

export function buildTopologyEdges(
  members: readonly MNetworkMember[],
  relayId: string | undefined,
  forcedRelayNodeIds: readonly string[] | undefined
): MNetOperationalSnapshotFromSchema['topology']['edges'] {
  if (relayId && forcedRelayNodeIds && forcedRelayNodeIds.length > 0) {
    return forcedRelayNodeIds.map(nodeId => ({
      edgeId: `${nodeId}->${relayId}:forced`,
      fromNodeId: nodeId,
      toNodeId: relayId,
      relation: 'forced-relay' as const
    }))
  }
  if (relayId) {
    return members.map(member => ({
      edgeId: `${member.nodeId}->${relayId}:relay`,
      fromNodeId: member.nodeId,
      toNodeId: relayId,
      relation: 'relay' as const
    }))
  }

  const [head, ...tail] = members
  return head
    ? tail.map(member => ({
        edgeId: `${head.nodeId}<->${member.nodeId}:peer`,
        fromNodeId: head.nodeId,
        toNodeId: member.nodeId,
        relation: 'peer' as const
      }))
    : []
}

export function buildReadinessReasons(
  members: readonly MNetworkMember[],
  sidecars: Sidecars,
  topologyEdgeCount: number,
  projection: ProjectionState,
  compatibilityMigration: MNetMigrationRequiredFromSchema | null
): ReadinessReason[] {
  const reasons: ReadinessReason[] = []

  if (projection.degradedReason) reasons.push(projection.degradedReason)
  if (members.length === 0) reasons.push({ code: 'network_not_ready', message: 'network has no joined nodes' })
  if (sidecars.length > 0 && topologyEdgeCount === 0) {
    reasons.push({ code: 'topology_missing', message: 'topology has no edges yet' })
  }
  if (projection.migration) {
    reasons.push({ code: 'migration_required', message: projection.migration.migration.message })
  } else if (compatibilityMigration) {
    reasons.push({ code: 'migration_required', message: compatibilityMigration.message })
  }

  for (const sidecar of sidecars) {
    if (sidecar.stale) {
      reasons.push({
        code: 'sidecar_report_stale',
        message: `sidecar report for ${sidecar.nodeId} is stale`,
        nodeId: sidecar.nodeId,
        ...(sidecar.staleForMs !== undefined ? { staleForMs: sidecar.staleForMs } : {}),
        ...(sidecar.checkedAt ? { observedAt: sidecar.checkedAt } : {})
      })
    }
    if (sidecar.healthStatus === 'degraded' || sidecar.healthStatus === 'unhealthy') {
      reasons.push({
        code: 'sidecar_unhealthy',
        message: `sidecar ${sidecar.nodeId} health is ${sidecar.healthStatus}`,
        nodeId: sidecar.nodeId,
        ...(sidecar.checkedAt ? { observedAt: sidecar.checkedAt } : {})
      })
    }
    if (sidecar.credentialStatus === 'missing') {
      reasons.push({ code: 'credential_missing', message: `credential missing for ${sidecar.nodeId}` })
    }
    if (sidecar.credentialStatus === 'expired') {
      reasons.push({ code: 'credential_expired', message: `credential expired for ${sidecar.nodeId}` })
    }
    if (sidecar.credentialStatus === 'rotation_required') {
      reasons.push({
        code: 'credential_rotation_required',
        message: `credential rotation required for ${sidecar.nodeId}`
      })
    }
  }

  return reasons
}

export function summarizeCredential(
  status: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
) {
  switch (status) {
    case 'missing':
      return 'Credential is missing'
    case 'pending':
      return 'Credential is pending'
    case 'ready':
      return 'Credential is ready'
    case 'expired':
      return 'Credential has expired'
    case 'rotation_required':
      return 'Credential rotation is required'
  }
}

export function operationalFailure(
  status: 404 | 503,
  code: string,
  message: string
): OperationalSnapshotFailure {
  return {
    kind: 'failure',
    status,
    error: { code, message }
  }
}

export function coerceProfileVersion(value: string): MNetOperationalProfileVersionFromSchema {
  switch (value) {
    case 'm-net@0.3.0':
    case 'm-net-cn@0.3.0':
      return value
    default:
      return value.includes('-cn@') ? 'm-net-cn@0.3.0' : 'm-net@0.3.0'
  }
}

export function hasObservedV03Runtime(projection: ProjectionState): boolean {
  const versions = [
    projection.topology?.profileVersion,
    ...projection.sidecarLifecycleByNode.values().map(value => value.profileVersion),
    ...projection.sidecarHealthByNode.values().map(value => value.profileVersion),
    ...projection.credentialByNode.values().map(value => value.profileVersion)
  ]

  return versions.some(value => value === 'm-net@0.3.0' || value === 'm-net-cn@0.3.0')
}

export function readCorrelationId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('correlationId' in payload)) return undefined
  const value = payload.correlationId
  return typeof value === 'string' ? value : undefined
}

function summarizeSidecar(
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | undefined,
  credentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required',
  stale: boolean,
  desiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop' | undefined
) {
  if (stale) return 'Latest sidecar report is stale'
  if (healthStatus === 'unhealthy') return 'Sidecar health is unhealthy'
  if (healthStatus === 'degraded') return 'Sidecar health is degraded'
  if (credentialStatus === 'missing') return 'Credential is missing'
  if (credentialStatus === 'expired') return 'Credential has expired'
  if (credentialStatus === 'rotation_required') return 'Credential rotation is required'
  return desiredState ? `Desired sidecar state is ${desiredState}` : 'Waiting for first runtime report'
}

function inferCredentialStatus(input: {
  expectsSidecar: boolean
  hasHealthReport: boolean
}): 'missing' | 'ready' {
  if (!input.expectsSidecar) return 'ready'
  return input.hasHealthReport ? 'ready' : 'missing'
}
