import { swagger } from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { createGlobalDefaultsRoutes } from './global-defaults-routes.ts'
import { createInternalRoutes } from './internal-routes.ts'
import { createNodeRuntimeRoutes } from './node-runtime-routes.ts'
import { createProfileAdminRoutes } from './profile-admin-routes.ts'
import { createProfileRoutes } from './profile-routes.ts'
import { createReadyRoute } from './ready-route.ts'

export type { MNetAppDeps } from './deps.ts'
export type { MNetServiceError, MNetServiceResult } from './types.ts'

export function createMNetApp(deps: MNetAppDeps) {
  return new Elysia()
    .use(
      swagger({
        path: '/api/v0/openapi',
        documentation: { info: { title: 'M-Net API', version: '0.1.0' } }
      })
    )
    .get('/health', () => ({ ok: true as const, service: 'm-net' as const }))
    .use(createReadyRoute(deps))
    .use(createInternalRoutes(deps))
    .use(createNodeRuntimeRoutes(deps))
    .use(createProfileAdminRoutes(deps))
    .use(createProfileRoutes(deps))
    .use(createGlobalDefaultsRoutes(deps))
}

export type MNetApp = ReturnType<typeof createMNetApp>
