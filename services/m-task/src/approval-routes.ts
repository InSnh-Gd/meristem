import { Elysia, t } from 'elysia'
import type { MTaskDeps } from './deps.ts'
import {
  ensureOperationNotExpired,
  ensureSuspendedForAction,
  isApprovalRouteFailure,
  loadSuspendedOperation,
  rejectSuspendedOperation,
  requireApprovalRouteContext,
  resumeSuspendedOperation
} from './approval-support.ts'
import { apiErrorSchema, taskSchema } from './route-schemas.ts'

/**
 * 审批恢复/拒绝路由维持内部 token、幂等冲突、过期处理和事件发布顺序不变。
 */
export function createApprovalRoutes(deps: MTaskDeps) {
  return new Elysia()
    .post(
      '/internal/v0/task-operations/:id/resume',
      async ({ params, headers, status }) => {
        const route = requireApprovalRouteContext(deps, headers)
        if (isApprovalRouteFailure(route)) return status(route.status, route.body)

        const suspendedOp = await loadSuspendedOperation(
          route.suspendedOps,
          params.id,
          route.correlationId
        )
        if (isApprovalRouteFailure(suspendedOp)) return status(suspendedOp.status, suspendedOp.body)

        const suspendedCheck = await ensureSuspendedForAction(deps, {
          suspendedOp,
          action: 'resume'
        })
        if (suspendedCheck !== true) return status(suspendedCheck.status, suspendedCheck.body)

        const expiryCheck = await ensureOperationNotExpired(deps, route.suspendedOps, suspendedOp)
        if (expiryCheck !== true) return status(expiryCheck.status, expiryCheck.body)

        const result = await resumeSuspendedOperation(deps, route.suspendedOps, suspendedOp)
        if (isApprovalRouteFailure(result)) return status(result.status, result.body)
        return result
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({
            resumed: t.Boolean(),
            suspendedOpId: t.String(),
            task: t.Nullable(taskSchema)
          }),
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
          501: apiErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/task-operations/:id/reject',
      async ({ params, headers, status }) => {
        const route = requireApprovalRouteContext(deps, headers)
        if (isApprovalRouteFailure(route)) return status(route.status, route.body)

        const suspendedOp = await loadSuspendedOperation(
          route.suspendedOps,
          params.id,
          route.correlationId
        )
        if (isApprovalRouteFailure(suspendedOp)) return status(suspendedOp.status, suspendedOp.body)

        const suspendedCheck = await ensureSuspendedForAction(deps, {
          suspendedOp,
          action: 'reject'
        })
        if (suspendedCheck !== true) return status(suspendedCheck.status, suspendedCheck.body)

        return rejectSuspendedOperation(deps, route.suspendedOps, suspendedOp)
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({ rejected: t.Boolean(), suspendedOpId: t.String() }),
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
          501: apiErrorSchema
        }
      }
    )
}
