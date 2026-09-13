import { Elysia, t } from 'elysia'
import { correlationIdFromHeader } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import {
  fetchLatestNetworkMap,
  registerNodePublicKey,
  requireDataPlaneDeps
} from './data-plane/mnet-dataplane-workflows.ts'
import type { MNetAppDeps } from './deps.ts'
import { isProfileWorkflowFailure } from './profile/profile-workflow-types.ts'
import { internalError, requireInternal, statusCodeForMNetError } from './route-helpers.ts'
import {
  createNetworkBodySchema,
  deleteNetworkResponseSchema,
  executeNoopBodySchema,
  internalErrorSchema,
  internalResponse,
  joinNetworkBodySchema,
  latestNetworkMapSchema,
  networkIdParamsSchema,
  networkMemberParamsSchema,
  networkMemberSchema,
  networkSchema,
  networkSummarySchema,
  nodeIdParamsSchema,
  nodeKeyRegistrationBodySchema,
  nodeKeyRegistrationResponseSchema,
  removeMemberResponseSchema,
  taskExecuteResponseSchema,
  updateNetworkMetadataBodySchema
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
        publicKey: map.map.signatureMetadata.publicKey,
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
    | 'deleteNetwork'
    | 'removeMember'
    | 'updateNetworkMetadata'
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
          const result = await deps.createNetwork({
            ...body,
            correlationId: correlationIdFromHeader(headers['x-correlation-id'])
          })
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
          const result = await deps.joinNetwork({
            networkId: params.id,
            nodeId: body.nodeId,
            correlationId: correlationIdFromHeader(headers['x-correlation-id'])
          })
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
    .delete(
      '/networks/:id',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        const { deleteNetwork } = deps
        if (!deleteNetwork) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'network deletion is not available'
          })
        }
        return withExtractedSpan('m-net', 'm-net.network.delete', headers, async () => {
          const result = await deleteNetwork({
            networkId: params.id,
            correlationId: correlationIdFromHeader(headers['x-correlation-id'])
          })
          return result.ok
            ? { deleted: true as const, networkId: result.value.networkId }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        params: networkIdParamsSchema,
        response: internalResponse(deleteNetworkResponseSchema, {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .delete(
      '/networks/:id/members/:nodeId',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        const { removeMember } = deps
        if (!removeMember) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'member removal is not available'
          })
        }
        return withExtractedSpan('m-net', 'm-net.network.member.remove', headers, async () => {
          const result = await removeMember({
            networkId: params.id,
            nodeId: params.nodeId,
            // 调用方（Core）经 x-correlation-id 透传同一条链路；缺失时在此补值，
            // 保证成员移除触发的 map 刷新与上游审计/事件可关联。
            correlationId: correlationIdFromHeader(headers['x-correlation-id'])
          })
          return result.ok
            ? { networkId: result.value.networkId, nodeId: result.value.nodeId }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        params: networkMemberParamsSchema,
        response: internalResponse(removeMemberResponseSchema, {
          404: internalErrorSchema,
          503: internalErrorSchema
        })
      }
    )
    .patch(
      '/networks/:id',
      async ({ params, body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        const { updateNetworkMetadata } = deps
        if (!updateNetworkMetadata) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'network metadata update is not available'
          })
        }
        return withExtractedSpan('m-net', 'm-net.network.metadata.update', headers, async () => {
          const result = await updateNetworkMetadata({
            networkId: params.id,
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {})
          })
          return result.ok
            ? { network: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      },
      {
        params: networkIdParamsSchema,
        body: updateNetworkMetadataBodySchema,
        response: internalResponse(t.Object({ network: networkSchema }), {
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
