import { Elysia } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import {
  isProfileAdminFailure,
  rejectProfileAdminOperation,
  requireProfileAdminDeps,
  resumeProfileAdminOperation
} from './profile-admin-support.ts'
import { internalError, requireInternal } from './route-helpers.ts'
import { operationIdParamsSchema } from './route-schemas.ts'

/**
 * M-Policy 内部回调只允许经内部信道恢复或拒绝挂起操作，避免外部 API 直接操纵审批结果。
 */
export function createProfileAdminRoutes(
  deps: Pick<
    MNetAppDeps,
    'profileStore' | 'suspendedOps' | 'networkUpdater' | 'events' | 'log' | 'listMembers'
  >
) {
  return new Elysia({ prefix: '/internal/v0' })
    .post(
      '/network-profile-operations/:id/resume',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        const profileAdminDeps = requireProfileAdminDeps(deps)
        if (isProfileAdminFailure(profileAdminDeps)) {
          return internalError(status, profileAdminDeps.status, profileAdminDeps.error)
        }

        const result = await resumeProfileAdminOperation(profileAdminDeps, params.id)
        if (isProfileAdminFailure(result)) {
          return internalError(status, result.status, result.error)
        }
        return result
      },
      {
        params: operationIdParamsSchema
      }
    )
    .post(
      '/network-profile-operations/:id/reject',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        const profileAdminDeps = requireProfileAdminDeps(deps)
        if (isProfileAdminFailure(profileAdminDeps)) {
          return internalError(status, profileAdminDeps.status, profileAdminDeps.error)
        }

        const result = await rejectProfileAdminOperation(profileAdminDeps, params.id)
        if (isProfileAdminFailure(result)) {
          return internalError(status, result.status, result.error)
        }
        return result
      },
      {
        params: operationIdParamsSchema
      }
    )
}
