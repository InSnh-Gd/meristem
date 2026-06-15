import { Elysia } from 'elysia'
import type { ActorId } from '../../../../packages/contracts/src/index.ts'
import { actorIds } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
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
  identityErrorStatus,
  inspectIdentityToken,
  issueTokenAuditPayload,
  revokeIdentityToken,
  validateIdentityInternalRequest,
  writeIdentityAudit
} from './identity-support.ts'
import { authorize, requireActor } from '../middleware/auth.ts'

/**
 * Identity token 与 introspection 路由统一处理高风险控制面写操作和内部服务鉴权。
 */
export const createIdentityTokenRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/identity' })
    // token 签发在返回明文前先完成 M-Policy 与 Audit，确保高风险控制操作 fail-closed。
    .post(
      '/tokens',
      async ({ body, headers, set }) => {
        if (!actorIds.includes(body.actor) || !body.ttl || !body.purpose) {
          throw new CoreError(
            400,
            'identity.token.invalid_request',
            'actor, ttl, and purpose are required'
          )
        }
        const auth = await requireActor(deps, headers)
        const permission = await authorize(deps, {
          actor: auth.actor,
          action: 'identity:token-issue',
          resource: `identity:token-issue:${body.actor}`,
          correlationId: auth.correlationId
        })

        await writeIdentityAudit(deps, {
          actor: auth.actor,
          action: 'identity:token-issue',
          resource: `identity:token:${body.actor}`,
          decisionId: permission.id,
          result: permission.result,
          correlationId: auth.correlationId,
          payload: issueTokenAuditPayload({
            targetActor: body.actor,
            ttl: body.ttl,
            purpose: body.purpose
          })
        })

        const issued = await deps.identity.issueToken({
          actor: body.actor,
          ttl: body.ttl,
          purpose: body.purpose,
          correlationId: auth.correlationId
        })
        if (!issued.ok) {
          throw new CoreError(
            identityErrorStatus(issued.error),
            issued.error.code,
            issued.error.message,
            auth.correlationId
          )
        }

        set.status = 201
        return {
          ...issued.value,
          issuer: 'meristem-local' as const,
          audience: 'meristem-core' as const,
          purpose: body.purpose,
          status: 'active' as const
        }
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
      const internalAuth = validateIdentityInternalRequest(request)
      if (!internalAuth.ok) {
        set.status = internalAuth.error.code === 'internal.unavailable' ? 503 : 401
        return { error: internalAuth.error }
      }

      const result = await deps.identity.introspect(body.jti)
      if (!result.ok) {
        return { jti: body.jti, active: false }
      }

      if (result.value.jti) {
        if (result.value.actor) {
          return {
            jti: result.value.jti,
            active: result.value.active,
            actor: result.value.actor as ActorId
          }
        }

        return {
          jti: result.value.jti,
          active: result.value.active
        }
      }

      if (result.value.actor) {
        return {
          jti: body.jti,
          active: result.value.active,
          actor: result.value.actor as ActorId
        }
      }

      return {
        jti: body.jti,
        active: result.value.active
      }
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
