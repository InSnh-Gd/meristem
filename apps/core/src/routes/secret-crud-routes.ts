import { Elysia, t } from 'elysia'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  secretCreateBodySchema,
  secretCreateRecordSchema,
  secretDetailRecordSchema,
  secretDisableBodySchema,
  secretDisableRecordSchema,
  secretListRecordSchema,
  secretParamsSchema,
  secretRotateBodySchema,
  secretRotateRecordSchema
} from './secrets-schemas.ts'
import {
  assertSecretIsMutable,
  redactSecretRecord,
  requireSecretPermission,
  requireSecretRecord,
  runSecretMutation,
  unwrapSecretResult
} from './secrets-support.ts'

/**
 * SecretRef CRUD 路由只暴露 metadata 与受控突变入口，明文 value 不会回流到响应或审计日志。
 */
export const createSecretCrudRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/secrets' })
    // 读取 metadata 仍走 M-Policy，避免低权限 actor 枚举 secretRef 名称和作用域。
    .get(
      '/',
      async ({ headers }) => {
        const { auth } = await requireSecretPermission(deps, {
          headers,
          action: 'secret:read-metadata',
          resource: 'secret:*'
        })

        const result = await deps.secrets.list()
        const secrets = unwrapSecretResult(result, auth.correlationId)

        return secrets.map(secret => redactSecretRecord(secret))
      },
      {
        response: {
          200: t.Array(secretListRecordSchema),
          401: apiErrorSchema,
          403: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('List secretRef metadata')
      }
    )
    // 单个 secretRef 详情只返回元数据；底层若错误或返回敏感字段，边界层仍统一再 redaction。
    .get(
      '/:id',
      async ({ params, headers }) => {
        const { auth } = await requireSecretPermission(deps, {
          headers,
          action: 'secret:read-metadata',
          resource: `secret:${params.id}`
        })

        const result = await deps.secrets.get(params.id)
        const secret = requireSecretRecord(unwrapSecretResult(result, auth.correlationId), {
          correlationId: auth.correlationId
        })

        return redactSecretRecord(secret)
      },
      {
        params: secretParamsSchema,
        response: {
          200: secretDetailRecordSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Show secretRef metadata')
      }
    )
    // create 接收明文只用于写入端口；Audit payload 与响应都不包含 value，防止请求明文回流到日志或客户端。
    .post(
      '/',
      async ({ body, headers, set }) => {
        const secret = await runSecretMutation(deps, {
          headers,
          action: 'secret:create',
          resource: `secret:${body.name}`,
          auditPayload: { name: body.name, scope: body.scope, metadata: body.metadata ?? {} },
          run: correlationId =>
            deps.secrets.create({
              name: body.name,
              scope: body.scope,
              value: body.value,
              ...(body.metadata ? { metadata: body.metadata } : {}),
              correlationId
            })
        })

        set.status = 201
        return redactSecretRecord(secret)
      },
      {
        body: secretCreateBodySchema,
        response: {
          201: secretCreateRecordSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Create a secretRef')
      }
    )
    // rotate 只把新值交给 SecretRefPort；审计记录 reason 与 decision，不记录旧值或新值。
    .post(
      '/:id/rotate',
      async ({ params, body, headers }) => {
        const secret = await runSecretMutation(deps, {
          headers,
          action: 'secret:rotate',
          resource: `secret:${params.id}`,
          auditPayload: { reason: body.reason },
          before: correlationId =>
            assertSecretIsMutable(deps, {
              id: params.id,
              correlationId,
              operation: 'rotate'
            }),
          run: correlationId =>
            deps.secrets.rotate(params.id, {
              value: body.value,
              reason: body.reason,
              correlationId
            })
        })

        return redactSecretRecord(secret)
      },
      {
        params: secretParamsSchema,
        body: secretRotateBodySchema,
        response: {
          200: secretRotateRecordSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Rotate a secretRef')
      }
    )
    // disable 与 rotate 一样先落 Audit 再突变，保证禁用操作即使后续失败也有可追踪控制面事实。
    .post(
      '/:id/disable',
      async ({ params, body, headers }) => {
        const secret = await runSecretMutation(deps, {
          headers,
          action: 'secret:disable',
          resource: `secret:${params.id}`,
          auditPayload: { reason: body.reason },
          before: correlationId =>
            assertSecretIsMutable(deps, {
              id: params.id,
              correlationId,
              operation: 'disable'
            }),
          run: correlationId =>
            deps.secrets.disable(params.id, {
              reason: body.reason,
              correlationId
            })
        })

        return redactSecretRecord(secret)
      },
      {
        params: secretParamsSchema,
        body: secretDisableBodySchema,
        response: {
          200: secretDisableRecordSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema
        },
        detail: protectedRouteDetail('Disable a secretRef')
      }
    )
