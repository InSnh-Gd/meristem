import { t } from 'elysia'

/**
 * ponytail: Elysia response schema 不能直接复用 Effect Schema 版 ApiErrorSchema，
 * 所以这里只放一个最小的路由层等价物，避免各服务重复手写同一份 error envelope。
 */
export const apiErrorRouteSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})
