import { Elysia, t } from 'elysia'
import { CoreError } from '../core-error.ts'
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
  secretErrorStatus,
  writeSecretAudit
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
        if (!result.ok) {
          throw new CoreError(500, result.error.code, result.error.message, auth.correlationId)
        }

        return result.value.map(secret => redactSecretRecord(secret))
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
        if (!result.ok) {
          throw new CoreError(
            secretErrorStatus(result.error),
            result.error.code,
            result.error.message,
            auth.correlationId
          )
        }
        if (result.value === null) {
          throw new CoreError(404, 'secret.not_found', 'secretRef not found', auth.correlationId)
        }

        return redactSecretRecord(result.value)
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
        const { auth, decision } = await requireSecretPermission(deps, {
          headers,
          action: 'secret:create',
          resource: `secret:${body.name}`
        })

        await writeSecretAudit(deps, {
          actor: auth.actor,
          action: 'secret:create',
          resource: `secret:${body.name}`,
          decisionId: decision.id,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { name: body.name, scope: body.scope, metadata: body.metadata ?? {} }
        })

        const created = await deps.secrets.create({
          name: body.name,
          scope: body.scope,
          value: body.value,
          ...(body.metadata ? { metadata: body.metadata } : {}),
          correlationId: auth.correlationId
        })
        if (!created.ok) {
          throw new CoreError(500, created.error.code, created.error.message, auth.correlationId)
        }

        set.status = 201
        return redactSecretRecord(created.value)
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
        const { auth, decision } = await requireSecretPermission(deps, {
          headers,
          action: 'secret:rotate',
          resource: `secret:${params.id}`
        })

        await writeSecretAudit(deps, {
          actor: auth.actor,
          action: 'secret:rotate',
          resource: `secret:${params.id}`,
          decisionId: decision.id,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { reason: body.reason }
        })

        await assertSecretIsMutable(deps, {
          id: params.id,
          correlationId: auth.correlationId,
          operation: 'rotate'
        })

        const rotated = await deps.secrets.rotate(params.id, {
          value: body.value,
          reason: body.reason,
          correlationId: auth.correlationId
        })
        if (!rotated.ok) {
          throw new CoreError(
            secretErrorStatus(rotated.error),
            rotated.error.code,
            rotated.error.message,
            auth.correlationId
          )
        }

        return redactSecretRecord(rotated.value)
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
        const { auth, decision } = await requireSecretPermission(deps, {
          headers,
          action: 'secret:disable',
          resource: `secret:${params.id}`
        })

        await writeSecretAudit(deps, {
          actor: auth.actor,
          action: 'secret:disable',
          resource: `secret:${params.id}`,
          decisionId: decision.id,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { reason: body.reason }
        })

        await assertSecretIsMutable(deps, {
          id: params.id,
          correlationId: auth.correlationId,
          operation: 'disable'
        })

        const disabled = await deps.secrets.disable(params.id, {
          reason: body.reason,
          correlationId: auth.correlationId
        })
        if (!disabled.ok) {
          throw new CoreError(
            secretErrorStatus(disabled.error),
            disabled.error.code,
            disabled.error.message,
            auth.correlationId
          )
        }

        return redactSecretRecord(disabled.value)
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
