import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { redactSecrets } from '../../../packages/common/src/secret-redaction.ts'
import { CoreError } from './core-error.ts'
import { approvalProfileFacadeRoutes } from './routes/approval-profile-facade.ts'
import { config, configApplyAck } from './routes/config.ts'
import { healthRoutes } from './routes/health.ts'
import { identity } from './routes/identity.ts'
import { logsRoutes } from './routes/logs.ts'
import { networksRoutes } from './routes/networks.ts'
import { nodesRoutes } from './routes/nodes.ts'
import { policyRoutes } from './routes/policy.ts'
import { projectionRoutes } from './routes/projection.ts'
import { secretReference, secrets } from './routes/secrets.ts'
import { servicesRoutes } from './routes/services.ts'
import type { CoreDeps } from './types.ts'

export function createCoreApp(deps: CoreDeps) {
  const degradedEventOpen = { value: false }

  return (
    new Elysia()
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
          return { error: { code: 'VALIDATION', message: redactSecrets(error.message) } }
        }
        if (code === 'NOT_FOUND') {
          set.status = 404
          return { error: { code: 'NOT_FOUND', message: 'Route not found' } }
        }
        return undefined
      })
      .use(
        // OpenAPI 只暴露对外 `/api/v0` 契约；内部 `/internal/v0` 路由继续运行，但绝不能进入公开文档。
        openapi({
          path: '/openapi',
          specPath: '/openapi/json',
          provider: 'swagger-ui',
          exclude: {
            paths: [
              '/internal/v0/identity/tokens/introspect',
              '/internal/v0/secrets/:id/reference',
              '/internal/v0/secrets/:id/disable',
              '/internal/v0/configs/:id/apply-ack'
            ]
          },
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
      .use(approvalProfileFacadeRoutes(deps))
      .use(projectionRoutes(deps))
      .use(identity(deps))
      .use(secrets(deps))
      .use(secretReference(deps))
      .use(config(deps))
      .use(configApplyAck(deps))
  )
}

export type CoreApp = ReturnType<typeof createCoreApp>
