import { Elysia } from 'elysia'
import type { MTaskDeps } from './deps.ts'
import { createApprovalRoutes } from './approval-routes.ts'

/**
 * 内部路由组合单独成层，保证 facade 只负责服务组装，不再承载审批实现细节。
 */
export function createInternalTaskRoutes(deps: MTaskDeps) {
  return new Elysia().use(createApprovalRoutes(deps))
}
