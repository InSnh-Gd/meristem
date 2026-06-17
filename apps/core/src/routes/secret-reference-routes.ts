import { Elysia } from 'elysia'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import { secretParamsSchema, secretReferenceRecordSchema } from './secrets-schemas.ts'
import {
  rejectUnavailableInternalSecretRoute,
  resolveInternalSecretReference
} from './secrets-support.ts'

/**
 * SecretRef internal reference 路由只为服务间调用暴露 metadata 与当前版本号。
 */
export const createSecretReferenceRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/internal/v0/secrets' })
    // 内部 reference 路由只返回 metadata 与当前版本号，通过 shared internal token 认证服务间调用。
    .post(
      '/:id/reference',
      async ({ params, headers: _headers, request }) => resolveInternalSecretReference(deps, { id: params.id, request }),
      {
        params: secretParamsSchema,
        response: {
          200: secretReferenceRecordSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Resolve internal secretRef metadata')
      }
    )
    // 该内部路径不是正式突变接口；保留认证门禁让缺少 internal token 的调用 fail-closed，而不是落入 404。
    .post(
      '/:id/disable',
      async ({ headers: _headers, request }) => rejectUnavailableInternalSecretRoute(request),
      {
        params: secretParamsSchema,
        response: {
          401: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: { summary: 'Reject unsupported internal secretRef disable route' }
      }
    )
