import { Elysia, t } from 'elysia'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  NetworkMapFromSchema,
  NodeAgentRuntimeDesiredSidecar
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  externalMigrationRequiredApiError,
  isMigrationRequiredFailure
} from './migration-required-support.ts'
import { isProfileWorkflowFailure } from './profile-workflow-types.ts'
import { externalApiError, statusCodeForMNetError } from './route-helpers.ts'
import {
  externalWriteErrorResponses,
  nodeIdParamsSchema,
  nodeKeyRegistrationBodySchema,
  nodeKeyRegistrationResponseSchema,
  nodeTunnelStatusBodySchema,
  nodeTunnelStatusResponseSchema
} from './route-schemas.ts'

type NodeRuntimeContext = {
  nodeRuntime: NonNullable<MNetAppDeps['nodeRuntime']>
}

function toLatestNetworkMapResponse(input: {
  map: NetworkMapFromSchema
  sidecar: NodeAgentRuntimeDesiredSidecar
}) {
  const { map, sidecar } = input
  return {
    map: {
      profileVersion: map.profileVersion,
      networkId: map.networkId,
      members: map.members.map(member => ({
        nodeId: member.nodeId,
        tunnelIp: member.tunnelIp,
        publicKey: member.publicKey,
        ...(member.endpoint ? { endpoint: member.endpoint } : {})
      })),
      aclRules: map.aclRules.map(rule => ({
        ruleId: rule.ruleId,
        action: rule.action,
        sourceNodeId: rule.sourceNodeId,
        targetNodeId: rule.targetNodeId,
        protocol: rule.protocol
      })),
      ...(map.relayAssignment
        ? {
            relayAssignment: {
              relayType: map.relayAssignment.relayType,
              relayEndpoint: map.relayAssignment.relayEndpoint,
              nodeIds: [...map.relayAssignment.nodeIds]
            }
          }
        : {}),
      expiresAt: map.expiresAt,
      mapVersion: map.mapVersion,
      signatureMetadata: {
        algorithm: map.signatureMetadata.algorithm,
        keyId: map.signatureMetadata.keyId,
        publicKey: map.signatureMetadata.publicKey,
        value: map.signatureMetadata.value
      }
    },
    sidecar: {
      signalConfigRef: { configRef: sidecar.signalConfigRef.configRef },
      relayConfigRef: { configRef: sidecar.relayConfigRef.configRef },
      stunConfigRef: { configRef: sidecar.stunConfigRef.configRef },
      sidecarCredentialRef: {
        provider: sidecar.sidecarCredentialRef.provider,
        keyPath: sidecar.sidecarCredentialRef.keyPath,
        ...(typeof sidecar.sidecarCredentialRef.version === 'number'
          ? { version: sidecar.sidecarCredentialRef.version }
          : {}),
        ...(sidecar.sidecarCredentialRef.metadata
          ? { metadata: { ...sidecar.sidecarCredentialRef.metadata } }
          : {})
      },
      desiredState: sidecar.desiredState,
      credentialStatus: sidecar.credentialStatus,
      healthStatus: sidecar.healthStatus,
      ...(sidecar.configHash ? { configHash: sidecar.configHash } : {})
    }
  }
}

async function requireAuthorizedNodeRuntimeContext(
  deps: Pick<MNetAppDeps, 'nodeRuntime'>,
  input: { headers: Record<string, string | undefined>; nodeId: string }
): Promise<NodeRuntimeContext | { status: 401 | 503; code: string; message: string }> {
  if (!deps.nodeRuntime) {
    return {
      status: 503,
      code: 'feature.unavailable',
      message: 'node runtime features are not available'
    }
  }

  const token = extractBearerToken(input.headers.authorization)
  if (!token) {
    return {
      status: 401,
      code: 'nodeagent.invalid_token',
      message: 'invalid or missing node runtime token'
    }
  }

  const authorized = await deps.nodeRuntime.authorize(input.nodeId, token)
  if (!authorized) {
    return {
      status: 401,
      code: 'nodeagent.invalid_token',
      message: 'invalid or missing node runtime token'
    }
  }

  return { nodeRuntime: deps.nodeRuntime }
}

export function createNodeRuntimeRoutes(
  deps: Pick<MNetAppDeps, 'nodeRuntime' | 'ingestOperationalEvent' | 'removeMember'>
) {
  return new Elysia({ prefix: '/api/v0/node-runtime' })
    .get(
      '/nodes/:nodeId/network-map',
      async ({ params, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }

        const result = await context.nodeRuntime.fetchLatestNetworkMap(params.nodeId)
        if ('kind' in result) {
          if (isProfileWorkflowFailure(result) && isMigrationRequiredFailure(result)) {
            return externalMigrationRequiredApiError(set, result.status, result.error.migration)
          }
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return toLatestNetworkMapResponse(result)
      },
      {
        params: nodeIdParamsSchema,
        response: {
          200: t.Any(),
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
    .post(
      '/nodes/:nodeId/key',
      async ({ params, body, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }

        const result = await context.nodeRuntime.registerNodePublicKey({
          nodeId: params.nodeId,
          keyId: body.keyId,
          publicKey: body.publicKey,
          createdAt: body.createdAt,
          ...(body.endpoint ? { endpoint: body.endpoint } : {})
        })
        if ('kind' in result) {
          if (isProfileWorkflowFailure(result) && isMigrationRequiredFailure(result)) {
            return externalMigrationRequiredApiError(set, result.status, result.error.migration)
          }
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return result
      },
      {
        params: nodeIdParamsSchema,
        body: nodeKeyRegistrationBodySchema,
        response: {
          200: nodeKeyRegistrationResponseSchema,
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
    .post(
      '/nodes/:nodeId/tunnel-status',
      async ({ params, body, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }
        if (!deps.ingestOperationalEvent) {
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'operational event ingestion is not available'
          )
        }

        // 节点上报统一走运营事件读模型：M-Net 不为节点状态另立事实源
        const correlationId = crypto.randomUUID()
        const result = await deps.ingestOperationalEvent({
          networkId: body.networkId,
          eventId: `tunnel-status:${params.nodeId}:${body.checkedAt}`,
          event: {
            subject: 'mnet.sidecar.health.v0',
            payload: {
              networkId: body.networkId,
              nodeId: params.nodeId,
              profileVersion: body.profileVersion,
              healthStatus: body.healthStatus,
              previousHealthStatus: body.previousHealthStatus,
              signalReachable: body.signalReachable,
              relayReachable: body.relayReachable,
              stunReachable: body.stunReachable,
              checkedAt: body.checkedAt,
              correlationId
            }
          }
        })
        if ('kind' in result) {
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return {
          accepted: true as const,
          nodeId: params.nodeId,
          publishStatus: result.publishStatus,
          correlationId
        }
      },
      {
        params: nodeIdParamsSchema,
        body: nodeTunnelStatusBodySchema,
        response: {
          200: nodeTunnelStatusResponseSchema,
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
    .post(
      '/nodes/:nodeId/leave',
      async ({ params, body, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }
        const { removeMember } = deps
        if (!removeMember) {
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'node membership removal is not available'
          )
        }

        // 节点主动退出：M-Net 侧移除成员并重渲染地图；本地隧道由 agent 先行拆除
        const result = await removeMember({
          networkId: body.networkId,
          nodeId: params.nodeId
        })
        if (!result.ok) {
          return externalApiError(
            set,
            statusCodeForMNetError(result.error.code),
            result.error.code,
            result.error.message
          )
        }
        return {
          left: true as const,
          networkId: result.value.networkId,
          nodeId: result.value.nodeId
        }
      },
      {
        params: nodeIdParamsSchema,
        body: t.Object({ networkId: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({
            left: t.Literal(true),
            networkId: t.String(),
            nodeId: t.String()
          }),
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
}
