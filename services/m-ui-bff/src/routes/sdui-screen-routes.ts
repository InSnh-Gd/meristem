import { Elysia } from 'elysia'
import type { MUiBffRouteDeps } from '../deps.ts'
import { bearerTokenFromHeaders, bffError, passthroughCoreError } from './route-helpers.ts'
import { SDUI_V02_ROUTE_REGISTRY } from './route-registry.ts'
import { idParamsSchema } from './route-schemas.ts'

/**
 * SDUI 路由注册表通过 Core session 校验 Bearer token，再发布 BFF 自己的展示契约。
 */
export function createSduiScreenRoutes({ cf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/routes',
      async ({ headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const sessionRes = await cf('/api/v0/session', token)
        if (!sessionRes.ok) return passthroughCoreError(sessionRes)
        return SDUI_V02_ROUTE_REGISTRY
      },
      {
        detail: { summary: 'Read SDUI v0.2 route registry' }
      }
    )
    .get(
      '/api/v0/routes/:id',
      async ({ params, headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const sessionRes = await cf('/api/v0/session', token)
        if (!sessionRes.ok) return passthroughCoreError(sessionRes)

        const route = SDUI_V02_ROUTE_REGISTRY.routes.find(candidate => candidate.id === params.id)
        if (!route) return bffError(404, 'route.not_found', 'route not found')
        return { route }
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read one SDUI v0.2 route definition' }
      }
    )
}
