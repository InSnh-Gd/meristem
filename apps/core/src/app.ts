import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import type { CoreDeps } from './types.ts'
import { healthRoutes } from './routes/health.ts'
import { servicesRoutes } from './routes/services.ts'
import { networksRoutes } from './routes/networks.ts'
import { nodesRoutes } from './routes/nodes.ts'
import { tasksRoutes } from './routes/tasks.ts'
import { logsRoutes } from './routes/logs.ts'
import { policyRoutes } from './routes/policy.ts'
import { projectionRoutes } from './routes/projection.ts'

export function createCoreApp(deps: CoreDeps) {
  const degradedEventOpen = { value: false }

  return new Elysia()
    .use(
      openapi({
        documentation: {
          info: { title: 'Meristem Core API', version: 'v0' },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
              }
            }
          }
        }
      })
    )
    .use(healthRoutes(deps, degradedEventOpen))
    .use(servicesRoutes(deps))
    .use(networksRoutes(deps))
    .use(nodesRoutes(deps))
    .use(tasksRoutes(deps))
    .use(logsRoutes(deps))
    .use(policyRoutes(deps))
    .use(projectionRoutes(deps))
}

export type CoreApp = ReturnType<typeof createCoreApp>
