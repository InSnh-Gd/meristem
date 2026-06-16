import { Elysia, t } from 'elysia'
import { extensionPermission } from '../../../packages/contracts/src/literals.ts'
import {
  mExtensionApiRoutes,
  mExtensionResource,
  mExtensionServiceName
} from '../../../packages/contracts/src/types/extension.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MExtensionDeps } from './deps.ts'
import { authorize, readStore, requireActor } from './route-helpers.ts'
import { errorSchema, extensionPairSchema } from './route-schemas.ts'

/**
 * 管理路由保留原始 URL 与只读策略动作，只把实现从 facade 中拆出。
 */
export function createExtensionAdminRoutes(deps: MExtensionDeps) {
  return new Elysia()
    .get(
      mExtensionApiRoutes.collection,
      async ({ headers }) => {
        const auth = await requireActor(headers, deps.jwtSecret)
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.extension.list`,
          headers,
          async () => {
            await authorize(deps, auth, extensionPermission.read, mExtensionResource.collection)
            return Response.json({
              extensions: await readStore(auth.correlationId, () => deps.store.list())
            })
          }
        )
      },
      {
        response: {
          200: t.Object({ extensions: t.Array(extensionPairSchema) }),
          401: errorSchema,
          403: errorSchema
        }
      }
    )
    .get(
      mExtensionApiRoutes.detail,
      async ({ headers, params }) => {
        const auth = await requireActor(headers, deps.jwtSecret)
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.extension.get`,
          headers,
          async () => {
            await authorize(
              deps,
              auth,
              extensionPermission.read,
              `${mExtensionResource.prefix}:${params.id}`
            )
            const extension = await readStore(auth.correlationId, () => deps.store.get(params.id))
            if (!extension)
              throw Object.assign(new Error('extension not found'), {
                status: 404,
                code: 'extension.not_found',
                correlationId: auth.correlationId
              })
            return Response.json(extension)
          }
        )
      },
      {
        response: {
          200: extensionPairSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema
        }
      }
    )
}
