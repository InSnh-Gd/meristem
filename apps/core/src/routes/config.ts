import { Elysia } from 'elysia'
import type { CoreDeps } from '../types.ts'
import { createConfigApplyAckRoutes, createConfigApplyRoutes } from './config-apply-routes.ts'
import { createConfigCrudRoutes } from './config-crud-routes.ts'

/**
 * Config facade 只负责组装外部 CRUD 路由和高风险 apply 生命周期路由。
 */
export const config = (deps: CoreDeps) =>
  new Elysia().use(createConfigCrudRoutes(deps)).use(createConfigApplyRoutes(deps))

/**
 * Config internal ack facade 保持 Core app.ts 现有导出名和内部路径不变。
 */
export const configApplyAck = (deps: CoreDeps) => createConfigApplyAckRoutes(deps)
