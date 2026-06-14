import { Elysia } from 'elysia'
import type { LogAppDeps } from './deps.ts'
import { createHealthAdminRoutes } from './health-admin-routes.ts'
import { createLogQueryRoutes } from './log-query-routes.ts'
import { createLogWriteRoutes } from './log-write-routes.ts'
import { createProjectionSearchRoutes } from './projection-search-routes.ts'

/**
 * M-Log facade 只负责统一组合内部 HTTP 路由，避免 app.ts 再次退化成 god file。
 */
export function createLogApp(deps: LogAppDeps) {
  return new Elysia()
    .use(createHealthAdminRoutes(deps))
    .use(createLogWriteRoutes(deps))
    .use(createLogQueryRoutes(deps))
    .use(createProjectionSearchRoutes(deps))
}

export type LogApp = ReturnType<typeof createLogApp>
export type { LogAppDeps, ProjectionDeps, SearchDeps } from './deps.ts'
