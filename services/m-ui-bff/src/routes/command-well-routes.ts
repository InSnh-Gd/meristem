import { Elysia } from 'elysia'
import type { MUiBffRouteDeps } from '../deps.ts'
import { createCommandWellEligibilityRoutes } from './command-well-eligibility-routes.ts'
import { createCommandWellExecuteRoutes } from './command-well-execute-routes.ts'

/**
 * createCommandWellRoutes 保留 CommandWell 路由入口，只组合拆分后的子路由。
 */
export function createCommandWellRoutes(deps: MUiBffRouteDeps) {
  return new Elysia()
    .use(createCommandWellEligibilityRoutes(deps))
    .use(createCommandWellExecuteRoutes(deps))
}
