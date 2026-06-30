import {
  decodeMNetProfileV03Compatibility,
  type MNetMigrationRequiredFromSchema,
  type MNetOperationalEventIngestRequestFromSchema,
  type MNetOperationalEventIngestResponseFromSchema,
  type MNetOperationalSnapshotFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  buildReadinessReasons,
  buildSidecars,
  buildTopologyEdges,
  coerceProfileVersion,
  hasObservedV03Runtime,
  operationalFailure,
  type OperationalSnapshotFailure,
  type ProjectionState,
  readCorrelationId,
  summarizeCredential
} from './operational-read-model-support.ts'

type ReadModelDeps = {
  profileStore: NonNullable<MNetAppDeps['profileStore']>
  listMembers: MNetAppDeps['listMembers']
  dataPlane?: DataPlaneStores
  events?: NonNullable<MNetAppDeps['events']>
  now?: () => Date
}

/**
 * M-Net 运营读模型只聚合 proof UX 所需快照；权威事实仍来自 profile/network state 与 data-plane store。
 */
export function createOperationalReadModel(deps: ReadModelDeps) {
  const projections = new Map<string, ProjectionState>()

  function currentTime(): Date {
    return deps.now ? deps.now() : new Date()
  }

  function stateFor(networkId: string): ProjectionState {
    const existing = projections.get(networkId)
    if (existing) return existing
    const created: ProjectionState = {
      sidecarLifecycleByNode: new Map(),
      sidecarHealthByNode: new Map(),
      credentialByNode: new Map()
    }
    projections.set(networkId, created)
    return created
  }

  async function ingestEvent(
    input: MNetOperationalEventIngestRequestFromSchema
  ): Promise<MNetOperationalEventIngestResponseFromSchema | OperationalSnapshotFailure> {
    const observedAt = input.occurredAt ?? currentTime().toISOString()
    const projection = stateFor(input.networkId)

    switch (input.event.subject) {
      case 'mnet.sidecar.lifecycle.v0':
        projection.sidecarLifecycleByNode.set(input.event.payload.nodeId, input.event.payload)
        break
      case 'mnet.sidecar.health.v0':
        projection.sidecarHealthByNode.set(input.event.payload.nodeId, input.event.payload)
        break
      case 'mnet.topology.update.v0':
        projection.topology = input.event.payload
        break
      case 'mnet.migration.required.v0':
        projection.migration = input.event.payload
        break
      case 'mnet.forced_relay.change.v0':
        projection.forcedRelay = input.event.payload
        break
      case 'mnet.credential.expiry.v0':
        projection.credentialByNode.set(input.event.payload.nodeId, input.event.payload)
        break
    }

    projection.lastSubject = input.event.subject
    if (input.eventId) projection.lastEventId = input.eventId
    else delete projection.lastEventId
    projection.lastEventAt = observedAt
    delete projection.degradedReason

    let publishStatus: 'published' | 'degraded' = 'published'
    if (deps.events) {
      try {
        await deps.events.publish(
          input.event.subject,
          input.event.subject.replace(/\.v\d+$/, ''),
          input.event.payload,
          readCorrelationId(input.event.payload)
        )
      } catch (error) {
        publishStatus = 'degraded'
        projection.degradedReason = {
          code: 'eventbus_unavailable',
          message: error instanceof Error ? error.message : String(error),
          subject: input.event.subject,
          observedAt
        }
      }
    }

    const snapshot = await getSnapshot(input.networkId)
    if ('kind' in snapshot) return snapshot

    return {
      accepted: true,
      networkId: input.networkId,
      publishStatus,
      snapshotStatus: snapshot.deploymentReadiness.status,
      occurredAt: observedAt
    }
  }

  async function getSnapshot(
    networkId: string
  ): Promise<MNetOperationalSnapshotFromSchema | OperationalSnapshotFailure> {
    const networkState = await deps.profileStore.getNetworkState(networkId)
    if (!networkState) {
      return operationalFailure(404, 'network.not_found', 'network not found')
    }
    const membersResult = await deps.listMembers({ networkId })
    if (!membersResult.ok) {
      return operationalFailure(
        membersResult.error.code === 'network.not_found' ? 404 : 503,
        membersResult.error.code,
        membersResult.error.message
      )
    }

    const projection = stateFor(networkId)
    const members = membersResult.value
    const profileDefinition = await deps.profileStore.getDefinition(networkState.profileVersion)
    const compatibility = profileDefinition
      ? decodeMNetProfileV03Compatibility({
          ...profileDefinition,
          profileId: profileDefinition.profileVersion
        })
      : null
    const latestRelay = deps.dataPlane
      ? (await deps.dataPlane.relayAssignments.listByNetwork(networkId)).at(-1)
      : undefined
    const sidecars = buildSidecars(
      members,
      coerceProfileVersion(networkState.profileVersion),
      projection,
      currentTime()
    )
    const topologyEdges = buildTopologyEdges(
      members,
      latestRelay?.relayId,
      projection.forcedRelay?.affectedNodeIds
    )
    const hasObservedCompatibleRuntime = hasObservedV03Runtime(projection)
    const compatibilityMigration: MNetMigrationRequiredFromSchema | null =
      compatibility?.kind === 'migration_required' && !hasObservedCompatibleRuntime
        ? compatibility.migration
        : null
    const readinessReasons = buildReadinessReasons(
      members,
      sidecars,
      topologyEdges.length,
      projection,
      compatibilityMigration
    )
    const deploymentStatus = readinessReasons.some(reason =>
      ['migration_required', 'credential_missing', 'credential_expired'].includes(reason.code)
    )
      ? 'blocked'
      : readinessReasons.length > 0
        ? 'degraded'
        : 'healthy'

    return {
      networkId,
      network: {
        status: deploymentStatus === 'healthy' ? 'active' : 'degraded',
        memberCount: members.length,
        profileState: networkState.status,
        lastUpdatedAt: networkState.updatedAt,
        summary:
          members.length === 0
            ? 'Network has no joined nodes yet'
            : `${members.length} nodes tracked in the operational read model`
      },
      profileSelection: {
        profileVersion: coerceProfileVersion(networkState.profileVersion),
        displayName: profileDefinition?.displayName ?? networkState.profileVersion,
        schemaVersion: profileDefinition?.schemaVersion ?? 'unknown',
        region:
          profileDefinition?.region ??
          (networkState.profileVersion.includes('-cn@') ? 'cn' : 'unknown'),
        controlPlaneOnly: profileDefinition?.capabilities.controlPlaneOnly ?? false,
        compatibility:
          compatibility === null
            ? 'unknown'
            : compatibility.kind === 'profile'
              ? 'compatible'
              : 'migration_required',
        ...(compatibility && compatibility.kind === 'migration_required'
          ? { migration: compatibility.migration }
          : {})
      },
      eventStream: {
        status: projection.degradedReason ? 'degraded' : 'healthy',
        ...(projection.lastSubject ? { lastSubject: projection.lastSubject } : {}),
        ...(projection.lastEventId ? { lastEventId: projection.lastEventId } : {}),
        ...(projection.lastEventAt ? { lastEventAt: projection.lastEventAt } : {}),
        ...(projection.degradedReason ? { degradationReason: projection.degradedReason } : {})
      },
      sidecars,
      topology: {
        ...(projection.topology ? { topologyRevision: projection.topology.topologyRevision } : {}),
        ...(projection.topology ? { routeClass: projection.topology.routeClass } : {}),
        nodes: members.map(member => {
          const sidecar = sidecars.find(item => item.nodeId === member.nodeId)
          return {
            nodeId: member.nodeId,
            label: `${member.nodeKind}:${member.nodeId}`,
            nodeKind: member.nodeKind,
            healthStatus: sidecar?.healthStatus ?? 'unknown',
            state:
              sidecar?.credentialStatus === 'missing' || sidecar?.credentialStatus === 'expired'
                ? 'migration_required'
                : sidecar?.stale ||
                    sidecar?.healthStatus === 'degraded' ||
                    sidecar?.healthStatus === 'unhealthy'
                  ? 'degraded'
                  : sidecar?.healthStatus === 'healthy'
                    ? 'healthy'
                    : 'unknown'
          }
        }),
        edges: topologyEdges,
        summary:
          topologyEdges.length === 0
            ? 'Topology is waiting for the first relay or peer update'
            : `${members.length} nodes and ${topologyEdges.length} edges are visible`
      },
      credentials: {
        status: sidecars.some(
          item => item.credentialStatus === 'missing' || item.credentialStatus === 'expired'
        )
          ? 'blocked'
          : sidecars.some(
                item =>
                  item.credentialStatus === 'pending' ||
                  item.credentialStatus === 'rotation_required'
              )
            ? 'degraded'
            : 'healthy',
        nodes: sidecars.map(item => ({
          nodeId: item.nodeId,
          credentialStatus: item.credentialStatus,
          ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
          ...(item.credentialRef ? { credentialRef: item.credentialRef } : {}),
          summary: summarizeCredential(item.credentialStatus)
        })),
        summary:
          sidecars.length === 0
            ? 'Current profile does not require sidecar credentials'
            : 'Credential lifecycle is derived from the latest sidecar events'
      },
      migrationRequired: {
        required: Boolean(projection.migration) || Boolean(compatibilityMigration),
        ...(projection.migration ? { resourceKind: projection.migration.resourceKind } : {}),
        ...(projection.migration
          ? { migration: projection.migration.migration }
          : compatibilityMigration
            ? { migration: compatibilityMigration }
            : {}),
        summary:
          projection.migration?.migration.message ??
          (compatibilityMigration ? compatibilityMigration.message : 'No migration is required')
      },
      forcedRelay: {
        active: Boolean(projection.forcedRelay),
        ...(projection.forcedRelay ? { routeClass: projection.forcedRelay.routeClass } : {}),
        ...(projection.forcedRelay
          ? { selectorOwnership: projection.forcedRelay.selectorOwnership }
          : {}),
        ...(projection.forcedRelay ? { selector: projection.forcedRelay.selector } : {}),
        ...(projection.forcedRelay
          ? { operatorOverrideActive: projection.forcedRelay.operatorOverrideActive }
          : {}),
        affectedNodeIds: projection.forcedRelay?.affectedNodeIds ?? [],
        summary: projection.forcedRelay
          ? `${projection.forcedRelay.affectedNodeIds.length} nodes are pinned to forced relay`
          : 'Forced relay is not active'
      },
      deploymentReadiness: {
        status: deploymentStatus,
        summary:
          readinessReasons.length === 0
            ? 'Deployment is ready'
            : `${readinessReasons.length} readiness issue(s)`,
        reasons: readinessReasons
      },
      stateSources: {
        network: 'authoritative',
        profileSelection: 'authoritative',
        sidecars: 'read-model',
        topology: 'read-model',
        credentials: 'read-model',
        migration: 'read-model',
        forcedRelay: 'read-model',
        deploymentReadiness: 'composed',
        eventStream: 'read-model'
      }
    }
  }

  return { ingestEvent, getSnapshot }
}
