import { Elysia } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { isNodeControlFailure, type NodeControlFailure } from './node-control-workflow.ts'
import { externalApiError } from './route-helpers.ts'
import {
  externalWriteErrorResponses,
  nodeControlBodySchema,
  nodeControlResponseSchema,
  nodeIdParamsSchema
} from './route-schemas.ts'
import { requireAuthorizedNodeControlContext } from './node-control-support.ts'

function applyNodeControlFailure(
  set: { status?: unknown },
  failure: NodeControlFailure
): never {
  return externalApiError(set, failure.status, failure.error.code, failure.error.message)
}

/**
 * 节点行政控制对外归 M-Net 所有：handler 只做鉴权、schema 校验和结果映射，业务流程全部下沉到 workflow。
 */
export function createNodeControlRoutes(deps: Pick<MNetAppDeps, 'controlNode'>) {
  return new Elysia({ prefix: '/api/v0' }).post(
    '/nodes/:nodeId/control',
    async ({ params, body, headers, set }) => {
      const context = await requireAuthorizedNodeControlContext(deps, headers)
      if ('status' in context) {
        return externalApiError(set, context.status, context.code, context.message)
      }

      const result = await context.controlNode({
        actor: context.actor,
        nodeId: params.nodeId,
        action: body.action,
        reason: body.reason,
        ...(body.targetKind ? { targetKind: body.targetKind } : {})
      })

      if (isNodeControlFailure(result)) {
        return applyNodeControlFailure(set, result)
      }

      return result
    },
    {
      params: nodeIdParamsSchema,
      body: nodeControlBodySchema,
      response: {
        200: nodeControlResponseSchema,
        ...externalWriteErrorResponses
      }
    }
  )
}
