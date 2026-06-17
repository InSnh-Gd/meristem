import { Elysia } from 'elysia'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  actorTokenSchema,
  internalIntrospectionBodySchema,
  internalIntrospectionResponseSchema,
  issueTokenBodySchema,
  issueTokenResponseSchema,
  revokeTokenBodySchema,
  revokeTokenResponseSchema,
  tokenParamsSchema
} from './identity-schemas.ts'
import {
  introspectIdentityTokenInternal,
  issueIdentityToken,
  inspectIdentityToken,
  revokeIdentityToken
} from './identity-support.ts'

/**
 * Identity token 与 introspection 路由统一处理高风险控制面写操作和内部服务鉴权。
 */
export const createIdentityTokenRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/identity' })
    // token 签发在返回明文前先完成 M-Policy 与 Audit，确保高风险控制操作 fail-closed。
    .post(
      '/tokens',
      async ({ body, headers, set }) => {
        const token = await issueIdentityToken(deps, {
          actor: body.actor,
          ttl: body.ttl,
          purpose: body.purpose,
          headers
        })

        set.status = 201
        return token
      },
      {
        body: issueTokenBodySchema,
        response: {
          201: issueTokenResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Issue an identity actor token')
      }
    )
    // token inspect 返回元数据而不回放明文 token，避免控制面读接口泄漏签发结果。
    .get(
      '/tokens/:jti',
      async ({ params, headers }) => inspectIdentityToken(deps, { jti: params.jti, headers }),
      {
        params: tokenParamsSchema,
        response: {
          200: actorTokenSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Inspect identity token metadata')
      }
    )
    // token revoke 与 issue 一样必须先写 Audit，再执行状态变更，保证审计事实先于突变落地。
    .post(
      '/tokens/:jti/revoke',
      async ({ params, body, headers }) =>
        revokeIdentityToken(deps, { jti: params.jti, reason: body.reason, headers }),
      {
        params: tokenParamsSchema,
        body: revokeTokenBodySchema,
        response: {
          200: revokeTokenResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Revoke an identity token')
      }
    )

/**
 * 内部 introspection 只信任 shared internal token，并在后端失败时回落为 inactive。
 */
export const createIdentityInternalRoutes = (deps: CoreDeps) =>
  new Elysia().post(
    '/internal/v0/identity/tokens/introspect',
    async ({ body, headers: _headers, set, request }) => {
      const introspection = await introspectIdentityTokenInternal(deps, {
        request,
        jti: body.jti
      })
      if (!introspection.ok) {
        set.status = introspection.status
        return { error: introspection.error }
      }

      return introspection.value
    },
    {
      body: internalIntrospectionBodySchema,
      response: {
        200: internalIntrospectionResponseSchema,
        401: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: { summary: 'Internal identity token introspection' }
    }
  )
