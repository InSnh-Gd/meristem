import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import { Elysia, t } from 'elysia'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type { MNetAppDeps } from './deps.ts'
import { isProfileWorkflowFailure } from './profile-workflow-types.ts'
import { externalApiError } from './route-helpers.ts'
import {
  externalWriteErrorResponses,
  latestNetworkMapSchema,
  nodeIdParamsSchema,
  nodeKeyRegistrationBodySchema,
  nodeKeyRegistrationResponseSchema
} from './route-schemas.ts'

type NodeRuntimeContext = {
  nodeRuntime: NonNullable<MNetAppDeps['nodeRuntime']>
}

function toLatestNetworkMapResponse(map: NetworkMapFromSchema) {
  return {
    map: {
      profileVersion: map.profileVersion,
      networkId: map.networkId,
      members: map.members.map(member => ({
        nodeId: member.nodeId,
        tunnelIp: member.tunnelIp,
        publicKey: member.publicKey
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

export function createNodeRuntimeRoutes(deps: Pick<MNetAppDeps, 'nodeRuntime'>) {
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
        if (isProfileWorkflowFailure(result)) {
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return toLatestNetworkMapResponse(result.map)
      },
      {
        params: nodeIdParamsSchema,
        response: {
          200: t.Object({ map: latestNetworkMapSchema }),
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
        if (isProfileWorkflowFailure(result)) {
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
}
