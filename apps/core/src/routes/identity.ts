import { Elysia } from 'elysia'
import type { CoreDeps } from '../types.ts'
import {
  createIdentityInternalRoutes,
  createIdentityTokenRoutes
} from './identity-token-routes.ts'
import { createIdentityLifecycleRoutes } from './identity-lifecycle-routes.ts'

/**
 * Identity v0.2 facade 只做路由组装，保持 Core app.ts 的公开导出与注册面不变。
 */
export const identity = (deps: CoreDeps) =>
  new Elysia()
    .use(createIdentityLifecycleRoutes(deps))
    .use(createIdentityTokenRoutes(deps))
    .use(createIdentityInternalRoutes(deps))
