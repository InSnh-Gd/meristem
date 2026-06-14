import { Elysia } from 'elysia'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import {
  approveApprovalForActor,
  createApprovalRecord,
  getApprovalDetailForActor,
  listApprovalsForActor,
  rejectApprovalForActor
} from './approval-execution.ts'
import {
  createInMemoryApprovalStore,
  createTestApproval,
  requireExternalActor,
  requirePermission
} from './approval-helpers.ts'
import {
  type ApprovalDeps,
  type ApprovalStore,
  apiErrorSchema,
  approvalActionSchema,
  approvalIdParamsSchema,
  approvalListSchema,
  approvalResponseSchema,
  approvalVoteBodySchema,
  approvalWithVotesSchema,
  createApprovalBodySchema
} from './approval-schemas.ts'

/**
 * M-Policy 外部审批 REST API，Bearer auth + M-Policy 权限。
 * facade 只负责 transport 编排，审批副作用与判定逻辑下沉到独立模块。
 */
export function createApprovalRoutes(deps: ApprovalDeps) {
  return new Elysia({ prefix: '/api/v0/policy/approvals' })
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string; correlationId?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return {
          error: { code: maybe.code, message: maybe.message, correlationId: maybe.correlationId }
        }
      }
      return undefined
    })
    .post(
      '/',
      async ({ body, headers }) => {
        const actor = await requireExternalActor(deps, headers)
        await requirePermission(deps, actor, 'policy:approval-manage', 'policy:approvals')
        return withExtractedSpan('m-policy', 'm-policy.approval.create', headers, () =>
          createApprovalRecord(deps, body, actor)
        )
      },
      {
        body: createApprovalBodySchema,
        response: {
          200: approvalResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema
        }
      }
    )
    .get(
      '/',
      async ({ headers }) => {
        const actor = await requireExternalActor(deps, headers)
        await requirePermission(deps, actor, 'policy:approval-read', 'policy:approvals')
        return withExtractedSpan('m-policy', 'm-policy.approval.list', headers, () =>
          listApprovalsForActor(deps)
        )
      },
      {
        response: {
          200: approvalListSchema,
          401: apiErrorSchema
        }
      }
    )
    .get(
      '/:id',
      async ({ params, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        await requirePermission(deps, actor, 'policy:approval-read', `approval:${params.id}`)
        return withExtractedSpan('m-policy', 'm-policy.approval.get', headers, async () => {
          const result = await getApprovalDetailForActor(deps, params.id)
          if (!result) {
            return status(404, {
              error: { code: 'approval.not_found', message: 'approval not found' }
            })
          }
          return result
        })
      },
      {
        params: approvalIdParamsSchema,
        response: {
          200: approvalWithVotesSchema,
          401: apiErrorSchema,
          404: apiErrorSchema
        }
      }
    )
    .post(
      '/:id/approve',
      async ({ params, body, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        await requirePermission(deps, actor, 'policy:approval-approve', `approval:${params.id}`)
        return withExtractedSpan('m-policy', 'm-policy.approval.approve', headers, async () => {
          const result = await approveApprovalForActor(deps, {
            id: params.id,
            actor,
            ...(body.reason !== undefined ? { reason: body.reason } : {})
          })
          if ('routeError' in result) return status(result.status, result.body)
          return result
        })
      },
      {
        params: approvalIdParamsSchema,
        body: approvalVoteBodySchema,
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
    .post(
      '/:id/reject',
      async ({ params, body, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        await requirePermission(deps, actor, 'policy:approval-reject', `approval:${params.id}`)
        return withExtractedSpan('m-policy', 'm-policy.approval.reject', headers, async () => {
          const result = await rejectApprovalForActor(deps, {
            id: params.id,
            actor,
            ...(body.reason !== undefined ? { reason: body.reason } : {})
          })
          if ('routeError' in result) return status(result.status, result.body)
          return result
        })
      },
      {
        params: approvalIdParamsSchema,
        body: approvalVoteBodySchema,
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
}

/**
 * 内部审批创建路由只接受 internal token，执行路径与外部创建共享同一套事件与审计顺序。
 */
export function createInternalApprovalRoutes(deps: ApprovalDeps) {
  return new Elysia({ prefix: '/internal/v0/policy/approvals' }).post(
    '/',
    async ({ body, headers, status }) => {
      const internalAuth = validateInternalRequest(headers)
      if (!internalAuth.ok) return status(401, { error: internalAuth.error })
      return createApprovalRecord(deps, body, 'system')
    },
    {
      body: createApprovalBodySchema,
      response: {
        200: approvalResponseSchema,
        401: apiErrorSchema
      }
    }
  )
}

export type ApprovalRoutes = ReturnType<typeof createApprovalRoutes>

export { type ApprovalDeps, type ApprovalStore, createInMemoryApprovalStore, createTestApproval }
