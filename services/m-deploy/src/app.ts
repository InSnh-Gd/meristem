import { Elysia } from 'elysia'
import { type ServedInternalApp, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import type { MDeployDeps } from './deps.ts'
import { createMDeployInternalRoutes } from './internal-routes.ts'
import { createMDeployPublicRoutes } from './public-routes.ts'

/** M-Deploy facade 仅组合健康、Core-facing REST 和 loopback agent routes，不承载控制业务。 */
export function createMDeployApp(deps: MDeployDeps) {
  return new Elysia()
    .get('/health', () => ({ ok: true, service: 'm-deploy' }))
    .use(createMDeployPublicRoutes(deps))
    .use(createMDeployInternalRoutes(deps))
}

export type MDeployApp = ReturnType<typeof createMDeployApp>

/** 以共享 loopback registry 启动服务，避免将 agent control 面暴露为通用远程入口。 */
export function serveMDeployApp(deps: MDeployDeps): ServedInternalApp {
  const app = createMDeployApp(deps)
  return serveHttpApp('m-deploy', app.handle)
}
