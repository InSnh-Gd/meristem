import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import { Elysia, t } from 'elysia'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError } from '../middleware/route-support.ts'
import {
  apiErrorSchema,
  approvalDetailResponseSchema,
  approvalListResponseSchema,
  mNetRegionalProfileSchema,
  networkProfileListResponseSchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'

function bearerTokenOrThrow(headers: Record<string, string | undefined>, correlationId: string): string {
  const token = extractBearerToken(headers.authorization)
  if (!token) throw new CoreError(401, 'auth.missing_token', 'Bearer token is required', correlationId)
  return token
}

/**
 * Core 公开读 facade 只做认证、授权与错误收敛；真实数据仍由 M-Policy/M-Net 公共 HTTP API 拥有。
 */
export function approvalProfileFacadeRoutes(deps: CoreDeps) {
  return new Elysia()
    .get(
      '/api/v0/policy/approvals',
      async ({ headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: deps.approvalReader.requiredPermission,
          resource: 'policy:approvals',
          correlationId: auth.correlationId
        })
        const result = await deps.approvalReader.list({
          actor: auth.actor,
          bearerToken: bearerTokenOrThrow(headers, auth.correlationId),
          correlationId: auth.correlationId
        })
        if (!result.ok) {
          throw new CoreError(
            statusCodeForServiceError(result.error.code),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        return result.value
      },
      {
        response: protectedResponse(approvalListResponseSchema, { 503: apiErrorSchema }),
        detail: protectedRouteDetail('List policy approvals through Core facade')
      }
    )
    .get(
      '/api/v0/policy/approvals/:id',
      async ({ params, headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: deps.approvalReader.requiredPermission,
          resource: `approval:${params.id}`,
          correlationId: auth.correlationId
        })
        const result = await deps.approvalReader.get(params.id, {
          actor: auth.actor,
          bearerToken: bearerTokenOrThrow(headers, auth.correlationId),
          correlationId: auth.correlationId
        })
        if (!result.ok) {
          throw new CoreError(
            statusCodeForServiceError(result.error.code),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        if (!result.value) {
          throw new CoreError(404, 'approval.not_found', 'approval not found', auth.correlationId)
        }
        return result.value
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: protectedResponse(approvalDetailResponseSchema, {
          404: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('Read one policy approval through Core facade')
      }
    )
    .get(
      '/api/v0/network-profiles',
      async ({ headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: deps.networkProfileReader.requiredPermission,
          resource: 'network-profiles',
          correlationId: auth.correlationId
        })
        const result = await deps.networkProfileReader.list({
          actor: auth.actor,
          bearerToken: bearerTokenOrThrow(headers, auth.correlationId),
          correlationId: auth.correlationId
        })
        if (!result.ok) {
          throw new CoreError(
            statusCodeForServiceError(result.error.code),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        return result.value
      },
      {
        response: protectedResponse(networkProfileListResponseSchema, { 503: apiErrorSchema }),
        detail: protectedRouteDetail('List network profiles through Core facade')
      }
    )
    .get(
      '/api/v0/network-profiles/:profileVersion',
      async ({ params, headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: deps.networkProfileReader.requiredPermission,
          resource: `network-profile:${params.profileVersion}`,
          correlationId: auth.correlationId
        })
        const result = await deps.networkProfileReader.get(params.profileVersion, {
          actor: auth.actor,
          bearerToken: bearerTokenOrThrow(headers, auth.correlationId),
          correlationId: auth.correlationId
        })
        if (!result.ok) {
          throw new CoreError(
            statusCodeForServiceError(result.error.code),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        if (!result.value) {
          throw new CoreError(404, 'profile.not_found', 'profile not found', auth.correlationId)
        }
        return result.value
      },
      {
        params: t.Object({ profileVersion: t.String({ minLength: 1 }) }),
        response: protectedResponse(mNetRegionalProfileSchema, {
          404: apiErrorSchema,
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('Read one network profile through Core facade')
      }
    )
}
