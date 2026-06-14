import { t } from 'elysia'

/**
 * Core REST API 的跨域共享 Elysia schema 与受保护路由辅助函数。
 */
export const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

export function protectedRouteDetail(summary: string) {
  return { security: [{ bearerAuth: [] }], summary }
}

export function protectedResponse<
  TSuccess extends ReturnType<typeof t.Object>,
  const TExtra extends Record<number, ReturnType<typeof t.Object>> = Record<number, never>
>(success: TSuccess, extra?: TExtra) {
  return {
    200: success,
    401: apiErrorSchema,
    403: apiErrorSchema,
    ...(extra ?? {})
  } as const
}
