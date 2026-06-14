import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  createNetworkBodySchema,
  executeNoopBodySchema,
  internalErrorSchema,
  internalResponse,
  joinNetworkBodySchema,
  networkIdParamsSchema,
  networkMemberSchema,
  networkSchema,
  networkSummarySchema,
  taskExecuteResponseSchema
} from './route-schemas.ts'
import { internalError, requireInternal, statusCodeForMNetError } from './route-helpers.ts'

/**
 * 这一组 internal routes 是 Core -> M-Net 的显式同步业务边界：
 * 网络编排与 agent task execute 都必须经由这里，而不是继续使用 NATS RPC。
 */
export function createInternalRoutes(
  deps: Pick<
    MNetAppDeps,
    'createNetwork' | 'listNetworks' | 'joinNetwork' | 'listMembers' | 'executeNoop'
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
