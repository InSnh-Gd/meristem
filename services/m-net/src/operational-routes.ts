import { Elysia } from 'elysia'
import type { Static } from 'elysia'
import type {
  MNetOperationalEventIngestRequestFromSchema,
  MNetOperationalSnapshotFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  externalApiError,
  internalError,
  requireInternal,
  verifyBearerAuth
} from './route-helpers.ts'
import {
  internalErrorSchema,
  internalResponse,
  networkIdParamsSchema,
  operationalEventIngestBodySchema,
  operationalEventIngestResponseSchema,
  operationalExternalErrorResponses,
  operationalSnapshotResponseSchema
} from './operational-route-schemas.ts'

/**
 * 运营快照路由保持薄：鉴权、错误映射、调用 read-model seam。
 */
export function createOperationalRoutes(
  deps: Pick<MNetAppDeps, 'getOperationalState' | 'ingestOperationalEvent'>
) {
  return new Elysia()
    .get(
      '/api/v0/networks/:id/operational-state',
      async ({ params, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) {
          return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        }
        if (!deps.getOperationalState) {
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'operational read model is not available'
          )
        }

        const result = await deps.getOperationalState(params.id)
        if ('kind' in result) {
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }
        return toOperationalSnapshotResponse(result)
      },
      {
        params: networkIdParamsSchema,
        response: {
          200: operationalSnapshotResponseSchema,
          ...operationalExternalErrorResponses
        }
      }
    )
    .post(
      '/internal/v0/operational-events',
      async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        if (!deps.ingestOperationalEvent) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'operational event ingestion is not available'
          })
        }

        const result = await deps.ingestOperationalEvent(body as MNetOperationalEventIngestRequestFromSchema)
        return 'kind' in result && result.kind === 'failure'
          ? internalError(status, result.status === 404 ? 404 : 503, result.error)
          : result
      },
      {
        body: operationalEventIngestBodySchema,
        response: internalResponse(operationalEventIngestResponseSchema, {
          404: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
}

function toOperationalSnapshotResponse(snapshot: MNetOperationalSnapshotFromSchema): Static<typeof operationalSnapshotResponseSchema> {
  return {
    networkId: snapshot.networkId,
    network: {
      status: snapshot.network.status,
      memberCount: snapshot.network.memberCount,
      profileState: snapshot.network.profileState,
      lastUpdatedAt: snapshot.network.lastUpdatedAt,
      summary: snapshot.network.summary
    },
    profileSelection: {
      profileVersion: snapshot.profileSelection.profileVersion,
      displayName: snapshot.profileSelection.displayName,
      schemaVersion: snapshot.profileSelection.schemaVersion,
      region: snapshot.profileSelection.region,
      controlPlaneOnly: snapshot.profileSelection.controlPlaneOnly,
      compatibility: snapshot.profileSelection.compatibility,
      ...(snapshot.profileSelection.migration
        ? {
            migration: {
              ...snapshot.profileSelection.migration,
              affectedProfileIds: [...snapshot.profileSelection.migration.affectedProfileIds],
              affectedNodeIds: [...snapshot.profileSelection.migration.affectedNodeIds]
            }
          }
        : {})
    },
    eventStream: {
      status: snapshot.eventStream.status,
      ...(snapshot.eventStream.lastSubject ? { lastSubject: snapshot.eventStream.lastSubject } : {}),
      ...(snapshot.eventStream.lastEventId ? { lastEventId: snapshot.eventStream.lastEventId } : {}),
      ...(snapshot.eventStream.lastEventAt ? { lastEventAt: snapshot.eventStream.lastEventAt } : {}),
      ...(snapshot.eventStream.degradationReason
        ? {
            degradationReason: {
              code: snapshot.eventStream.degradationReason.code,
              message: snapshot.eventStream.degradationReason.message,
              ...(snapshot.eventStream.degradationReason.nodeId !== undefined
                ? { nodeId: snapshot.eventStream.degradationReason.nodeId }
                : {}),
              ...(snapshot.eventStream.degradationReason.subject !== undefined
                ? { subject: snapshot.eventStream.degradationReason.subject }
                : {}),
              ...(snapshot.eventStream.degradationReason.staleForMs !== undefined
                ? { staleForMs: snapshot.eventStream.degradationReason.staleForMs }
                : {}),
              ...(snapshot.eventStream.degradationReason.observedAt !== undefined
                ? { observedAt: snapshot.eventStream.degradationReason.observedAt }
                : {})
            }
          }
        : {})
    },
    sidecars: snapshot.sidecars.map(sidecar => ({
      nodeId: sidecar.nodeId,
      nodeKind: sidecar.nodeKind,
      profileVersion: sidecar.profileVersion,
      ...(sidecar.desiredState ? { desiredState: sidecar.desiredState } : {}),
      credentialStatus: sidecar.credentialStatus,
      ...(sidecar.credentialRef
        ? {
            credentialRef: {
              provider: sidecar.credentialRef.provider,
              keyPath: sidecar.credentialRef.keyPath,
              ...(sidecar.credentialRef.version !== undefined
                ? { version: sidecar.credentialRef.version }
                : {})
            }
          }
        : {}),
      ...(sidecar.expiresAt ? { expiresAt: sidecar.expiresAt } : {}),
      healthStatus: sidecar.healthStatus,
      ...(sidecar.checkedAt ? { checkedAt: sidecar.checkedAt } : {}),
      ...(sidecar.signalReachable !== undefined ? { signalReachable: sidecar.signalReachable } : {}),
      ...(sidecar.relayReachable !== undefined ? { relayReachable: sidecar.relayReachable } : {}),
      ...(sidecar.stunReachable !== undefined ? { stunReachable: sidecar.stunReachable } : {}),
      stale: sidecar.stale,
      ...(sidecar.staleForMs !== undefined ? { staleForMs: sidecar.staleForMs } : {}),
      summary: sidecar.summary
    })),
    topology: {
      ...(snapshot.topology.topologyRevision ? { topologyRevision: snapshot.topology.topologyRevision } : {}),
      ...(snapshot.topology.routeClass ? { routeClass: snapshot.topology.routeClass } : {}),
      nodes: snapshot.topology.nodes.map(node => ({ ...node })),
      edges: snapshot.topology.edges.map(edge => ({ ...edge })),
      summary: snapshot.topology.summary
    },
    credentials: {
      status: snapshot.credentials.status,
      nodes: snapshot.credentials.nodes.map(node => ({
        nodeId: node.nodeId,
        credentialStatus: node.credentialStatus,
        ...(node.expiresAt ? { expiresAt: node.expiresAt } : {}),
        ...(node.credentialRef
          ? {
              credentialRef: {
                provider: node.credentialRef.provider,
                keyPath: node.credentialRef.keyPath,
                ...(node.credentialRef.version !== undefined
                  ? { version: node.credentialRef.version }
                  : {})
              }
            }
          : {}),
        summary: node.summary
      })),
      summary: snapshot.credentials.summary
    },
    migrationRequired: {
      required: snapshot.migrationRequired.required,
      ...(snapshot.migrationRequired.resourceKind
        ? { resourceKind: snapshot.migrationRequired.resourceKind }
        : {}),
      ...(snapshot.migrationRequired.migration
        ? {
            migration: {
              ...snapshot.migrationRequired.migration,
              affectedProfileIds: [...snapshot.migrationRequired.migration.affectedProfileIds],
              affectedNodeIds: [...snapshot.migrationRequired.migration.affectedNodeIds]
            }
          }
        : {}),
      summary: snapshot.migrationRequired.summary
    },
    forcedRelay: {
      active: snapshot.forcedRelay.active,
      ...(snapshot.forcedRelay.routeClass ? { routeClass: snapshot.forcedRelay.routeClass } : {}),
      ...(snapshot.forcedRelay.selectorOwnership
        ? { selectorOwnership: snapshot.forcedRelay.selectorOwnership }
        : {}),
      ...(snapshot.forcedRelay.selector
        ? {
            selector:
              snapshot.forcedRelay.selector.selectorType === 'node-ids'
                ? {
                    selectorType: 'node-ids' as const,
                    nodeIds: [...snapshot.forcedRelay.selector.nodeIds]
                  }
                : { ...snapshot.forcedRelay.selector }
          }
        : {}),
      ...(snapshot.forcedRelay.operatorOverrideActive !== undefined
        ? { operatorOverrideActive: snapshot.forcedRelay.operatorOverrideActive }
        : {}),
      affectedNodeIds: [...snapshot.forcedRelay.affectedNodeIds],
      summary: snapshot.forcedRelay.summary
    },
    deploymentReadiness: {
      status: snapshot.deploymentReadiness.status,
      summary: snapshot.deploymentReadiness.summary,
      reasons: snapshot.deploymentReadiness.reasons.map(reason => ({
        code: reason.code,
        message: reason.message,
        ...(reason.nodeId !== undefined ? { nodeId: reason.nodeId } : {}),
        ...(reason.subject !== undefined ? { subject: reason.subject } : {}),
        ...(reason.staleForMs !== undefined ? { staleForMs: reason.staleForMs } : {}),
        ...(reason.observedAt !== undefined ? { observedAt: reason.observedAt } : {})
      }))
    },
    stateSources: { ...snapshot.stateSources }
  }
}
