import { Elysia } from 'elysia'
import type { MDeployBffRouteDeps } from './deps.ts'
import { createBffMDeployManagementRoutes } from './routes/mdeploy-management-routes.ts'

/** Standalone composition seam for the M-Deploy workbench BFF route set. */
export function createMDeployWorkbenchBffApp(deps: MDeployBffRouteDeps) {
  return new Elysia().use(createBffMDeployManagementRoutes(deps))
}
