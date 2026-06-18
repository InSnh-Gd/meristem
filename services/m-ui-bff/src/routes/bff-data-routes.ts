import { Elysia } from 'elysia'
import type { MUiBffRouteDeps } from '../deps.ts'
import { createBffDetailRoutes } from './bff-detail-routes.ts'
import { createBffListRoutes } from './bff-list-routes.ts'
import { createBffMNetDataplaneRoutes } from './bff-mnet-dataplane-routes.ts'
import { createBffOverviewRoute } from './bff-overview-route.ts'

/**
 * createBffDataRoutes 负责 BFF 展示读模型：只补 stateSource，不改变 Core/M-Log/Audit 事实归属。
 */
export function createBffDataRoutes(deps: MUiBffRouteDeps) {
  const listRoutes = createBffListRoutes(deps)
  const overviewRoute = createBffOverviewRoute(deps)
  const detailRoutes = createBffDetailRoutes(deps)
  const mnetDataplaneRoutes = createBffMNetDataplaneRoutes(deps)

  return new Elysia().use(listRoutes).use(overviewRoute).use(detailRoutes).use(mnetDataplaneRoutes)
}
