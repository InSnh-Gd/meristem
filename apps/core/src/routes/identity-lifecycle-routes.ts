import { Elysia } from 'elysia'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  actorParamsSchema,
  identityActorResponseSchema,
  identityActorsResponseSchema
} from './identity-schemas.ts'
import { identityErrorStatus, toIdentityActorRecord } from './identity-support.ts'

/**
 * Identity actor 路由只暴露生命周期元数据读取，避免与 token 控制面写操作耦合。
 */
export const createIdentityLifecycleRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/identity' })
    // actor 列表属于身份控制面读接口；这里显式走 Bearer + M-Policy，避免直接暴露 Core 身份表。
    .get(
      '/actors',
      async ({ headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: 'identity:read',
          resource: 'identity:actors',
          correlationId: auth.correlationId
        })

        const result = await deps.identity.listActors()
        if (!result.ok) {
          throw new CoreError(
            identityErrorStatus(result.error),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }

        return { actors: result.value.map(toIdentityActorRecord) }
      },
      {
        response: {
          200: identityActorsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('List identity actors')
      }
    )
    // actor 详情读取与 token 管理解耦，避免用 token inspect 替代 actor 元数据读取。
    .get(
      '/actors/:id',
      async ({ params, headers }) => {
        const auth = await requireActor(deps, headers)
        await authorize(deps, {
          actor: auth.actor,
          action: 'identity:read',
          resource: `identity:actor:${params.id}`,
          correlationId: auth.correlationId
        })

        const result = await deps.identity.getActor(params.id)
        if (!result.ok) {
          throw new CoreError(
            identityErrorStatus(result.error),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        if (result.value === null) {
          throw new CoreError(
            404,
            'identity.actor.not_found',
            'identity actor not found',
            auth.correlationId
          )
        }

        return { actor: toIdentityActorRecord(result.value) }
      },
      {
        params: actorParamsSchema,
        response: {
          200: identityActorResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Show one identity actor')
      }
    )
