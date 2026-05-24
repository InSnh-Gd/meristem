import { CoreError } from './core-error.ts'
import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import type { CoreDeps } from './types.ts'
import { healthRoutes } from './routes/health.ts'
import { servicesRoutes } from './routes/services.ts'
import { networksRoutes } from './routes/networks.ts'
import { nodesRoutes } from './routes/nodes.ts'
import { logsRoutes } from './routes/logs.ts'
import { policyRoutes } from './routes/policy.ts'
import { projectionRoutes } from './routes/projection.ts'

export function createCoreApp(deps: CoreDeps) {
  const degradedEventOpen = { value: false }

  return new Elysia()
    .error({ CoreError })
    // 全局错误钩子仅收敛框架级错误，避免路由各自拼装不一致 envelope
    .onError(({ code, error, set }): unknown => {
      if (error instanceof CoreError) {
        set.status = error.status
        const envelope: { code: string; message: string; correlationId?: string } = {
          code: error.code,
          message: error.message
        }
        if (error.correlationId) envelope.correlationId = error.correlationId
        return { error: envelope }
      }
      if (code === 'VALIDATION') {
        set.status = 400
        return { error: { code: 'VALIDATION', message: error.message } }
      }
      if (code === 'NOT_FOUND') {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'Route not found' } }
      }
      return undefined
    })
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
    .use(logsRoutes(deps))
    .use(policyRoutes(deps))
    .use(projectionRoutes(deps))
}

export type CoreApp = ReturnType<typeof createCoreApp>
