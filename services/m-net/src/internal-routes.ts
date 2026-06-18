import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  fetchLatestNetworkMap,
  registerNodePublicKey,
  requireDataPlaneDeps
} from './mnet-dataplane-workflows.ts'
import { isProfileWorkflowFailure } from './profile-workflow-types.ts'
import { internalError, requireInternal, statusCodeForMNetError } from './route-helpers.ts'
import {
  createNetworkBodySchema,
  executeNoopBodySchema,
  internalErrorSchema,
  internalResponse,
  joinNetworkBodySchema,
  latestNetworkMapSchema,
  networkIdParamsSchema,
  networkMemberSchema,
  networkSchema,
  networkSummarySchema,
  nodeIdParamsSchema,
  nodeKeyRegistrationBodySchema,
  nodeKeyRegistrationResponseSchema,
  taskExecuteResponseSchema
} from './route-schemas.ts'

/**
 * 将持久化 network-map 转成路由 schema 期望的可变对象，避免只读数组泄漏到 Elysia 响应推断。
 */
function toLatestNetworkMapResponse(map: Awaited<ReturnType<typeof fetchLatestNetworkMap>>) {
  if (isProfileWorkflowFailure(map)) return map
  return {
    map: {
      profileVersion: map.map.profileVersion,
      networkId: map.map.networkId,
      members: map.map.members.map(member => ({
        nodeId: member.nodeId,
        tunnelIp: member.tunnelIp,
        publicKey: member.publicKey
      })),
      aclRules: map.map.aclRules.map(rule => ({
        ruleId: rule.ruleId,
        action: rule.action,
        sourceNodeId: rule.sourceNodeId,
        targetNodeId: rule.targetNodeId,
        protocol: rule.protocol
      })),
      ...(map.map.relayAssignment
        ? {
            relayAssignment: {
              relayType: map.map.relayAssignment.relayType,
              relayEndpoint: map.map.relayAssignment.relayEndpoint,
              nodeIds: [...map.map.relayAssignment.nodeIds]
            }
          }
        : {}),
      expiresAt: map.map.expiresAt,
      mapVersion: map.map.mapVersion,
      signatureMetadata: {
        algorithm: map.map.signatureMetadata.algorithm,
        keyId: map.map.signatureMetadata.keyId,
        value: map.map.signatureMetadata.value
      }
    }
  }
}

/**
 * 这一组 internal routes 是 Core -> M-Net 的显式同步业务边界：
 * 网络编排与 agent task execute 都必须经由这里，而不是继续使用 NATS RPC。
 */
export function createInternalRoutes(
  deps: Pick<
    MNetAppDeps,
    | 'createNetwork'
    | 'listNetworks'
    | 'joinNetwork'
    | 'listMembers'
    | 'executeNoop'
    | 'profileStore'
    | 'policyAuthorize'
    | 'events'
    | 'log'
    | 'networkUpdater'
  >
) {
  return new Elysia({ prefix: '/internal/v0' })
    .post(
      '/networks',
      async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.create', headers, async () => {
          const result = await deps.createNetwork(body)
          return result.ok
            ? { network: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        body: createNetworkBodySchema,
        response: internalResponse(t.Object({ network: networkSchema }), {
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .get(
      '/networks',
      async ({ headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.list', headers, async () => {
          const result = await deps.listNetworks()
          return result.ok
            ? { networks: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        response: internalResponse(t.Object({ networks: t.Array(networkSummarySchema) }), {
          503: internalErrorSchema
        })
      }
    )
    .post(
      '/networks/:id/members',
      async ({ params, body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.join', headers, async () => {
          const result = await deps.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
          return result.ok
            ? { member: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        params: networkIdParamsSchema,
        body: joinNetworkBodySchema,
        response: internalResponse(t.Object({ member: networkMemberSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .get(
      '/networks/:id/members',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.members.list', headers, async () => {
          const result = await deps.listMembers({ networkId: params.id })
          return result.ok
            ? { members: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        params: networkIdParamsSchema,
        response: internalResponse(t.Object({ members: t.Array(networkMemberSchema) }), {
          404: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .post(
      '/networks/:id/nodes/:nodeId/key',
      async ({ params, body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        const dataPlaneDeps = requireDataPlaneDeps(deps)
        if (isProfileWorkflowFailure(dataPlaneDeps)) {
          return internalError(status, 503, dataPlaneDeps.error)
        }
        const result = await registerNodePublicKey(dataPlaneDeps, {
          networkId: params.id,
          nodeId: params.nodeId,
          keyId: body.keyId,
          publicKey: body.publicKey,
          createdAt: body.createdAt
        })
        return 'kind' in result && result.kind === 'failure'
          ? internalError(status, statusCodeForMNetError(result.error.code), result.error)
          : result
      },
      {
        params: t.Composite([networkIdParamsSchema, nodeIdParamsSchema]),
        body: nodeKeyRegistrationBodySchema,
        response: internalResponse(nodeKeyRegistrationResponseSchema, {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .get(
      '/networks/:id/network-map',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        const dataPlaneDeps = requireDataPlaneDeps(deps)
        if (isProfileWorkflowFailure(dataPlaneDeps)) {
          return internalError(status, 503, dataPlaneDeps.error)
        }
        const result = await fetchLatestNetworkMap(dataPlaneDeps, params.id)
        const response = toLatestNetworkMapResponse(result)
        return isProfileWorkflowFailure(response)
          ? internalError(status, statusCodeForMNetError(response.error.code), response.error)
          : response
      },
      {
        params: networkIdParamsSchema,
        response: internalResponse(t.Object({ map: latestNetworkMapSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .post(
      '/tasks/noop',
      async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.task.execute.noop', headers, async () => {
          const result = await deps.executeNoop(body)
          return result.ok
            ? { result: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        body: executeNoopBodySchema,
        response: internalResponse(t.Object({ result: taskExecuteResponseSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
}
