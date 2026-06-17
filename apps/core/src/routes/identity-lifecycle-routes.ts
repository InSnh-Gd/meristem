import { Elysia } from 'elysia'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  actorParamsSchema,
  identityActorResponseSchema,
  identityActorsResponseSchema
} from './identity-schemas.ts'
import {
  requireIdentityReadAccess,
  requireIdentityRecord,
  toIdentityActorRecord,
  unwrapIdentityResult
} from './identity-support.ts'

/**
 * Identity actor 路由只暴露生命周期元数据读取，避免与 token 控制面写操作耦合。
 */
export const createIdentityLifecycleRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/identity' })
    // actor 列表属于身份控制面读接口；这里显式走 Bearer + M-Policy，避免直接暴露 Core 身份表。
    .get(
      '/actors',
      async ({ headers }) => {
        const auth = await requireIdentityReadAccess(deps, {
          headers,
          resource: 'identity:actors'
        })

        const actors = unwrapIdentityResult(await deps.identity.listActors(), auth.correlationId)

        return { actors: actors.map(toIdentityActorRecord) }
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
        const auth = await requireIdentityReadAccess(deps, {
          headers,
          resource: `identity:actor:${params.id}`
        })

        const actor = requireIdentityRecord(
          unwrapIdentityResult(await deps.identity.getActor(params.id), auth.correlationId),
          { kind: 'actor', correlationId: auth.correlationId }
        )

        return { actor: toIdentityActorRecord(actor) }
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
