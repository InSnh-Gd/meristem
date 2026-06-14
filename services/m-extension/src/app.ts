import { swagger } from '@elysiajs/swagger'
import { Elysia, t } from 'elysia'
import {
  mExtensionApiRoutes,
  mExtensionApiVersion,
  mExtensionServiceName
} from '../../../packages/contracts/src/types/extension.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MExtensionDeps } from './deps.ts'
import { createExtensionAdminRoutes } from './extension-admin-routes.ts'
import { createExtensionLifecycleRoutes } from './extension-lifecycle-routes.ts'
import { errorSchema } from './route-schemas.ts'

export type {
  MExtensionDeps,
  MExtensionError,
  MExtensionPolicyDecision,
  PolicyDecisionResult
} from './deps.ts'

/**
 * M-Extension facade 只负责错误映射、OpenAPI、健康检查与路由组合，避免再次退化成单体入口。
 */
export function createMExtensionApp(deps: MExtensionDeps) {
  return new Elysia()
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string; correlationId?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return {
          error: { code: maybe.code, message: maybe.message, correlationId: maybe.correlationId }
        }
      }
      return undefined
    })
    .use(
      swagger({
        path: mExtensionApiRoutes.openapi,
        documentation: { info: { title: 'M-Extension API', version: mExtensionApiVersion } }
      })
    )
    .get(mExtensionApiRoutes.health, () => ({ ok: true as const, service: mExtensionServiceName }))
    .get(
      mExtensionApiRoutes.ready,
      async ({ headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.ready`,
          headers,
          () => deps.readiness()
        )
      },
      { response: { 200: t.Object({ ready: t.Boolean() }), 401: errorSchema } }
    )
    .use(createExtensionAdminRoutes(deps))
    .use(createExtensionLifecycleRoutes(deps))
}

export type MExtensionApp = ReturnType<typeof createMExtensionApp>
