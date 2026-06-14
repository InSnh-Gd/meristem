import { Elysia } from 'elysia'
import { correlationIdFromHeader } from '../errors.ts'
import { protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  configApplyAckBodySchema,
  configParamsSchema,
  configPublishBodySchema,
  configRollbackBodySchema
} from './config-schemas.ts'
import {
  normalizeAckInput,
  requireConfigPolicy,
  throwConfigError,
  toAckResponseError,
  validateConfigInternalRequest,
  writeConfigAudit
} from './config-support.ts'

/**
 * Config apply 与 ack 路由统一承载高风险生命周期变更和内部回执接入。
 */
export const createConfigApplyRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/configs' })
    // publish 是高风险控制面突变：必须先 M-Policy allow，再写 Audit，最后才调用 ConfigPort 突变。
    .post(
      '/:id/publish',
      async ({ params, body, headers }) => {
        const { auth, decision } = await requireConfigPolicy(deps, {
          headers,
          action: 'config:publish',
          resource: `config:${params.id}`
        })
        await writeConfigAudit(deps, {
          actor: auth.actor,
          action: 'config:publish',
          resource: `config:${params.id}`,
          decisionId: decision.id,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { reason: body.reason }
        })
        const result = await deps.config.publish(params.id, {
          reason: body.reason,
          correlationId: auth.correlationId
        })
        if (!result.ok) throwConfigError(result.error, auth.correlationId)
        return { config: { ...result.value, status: result.value.status as 'published' } }
      },
      {
        params: configParamsSchema,
        body: configPublishBodySchema,
        detail: protectedRouteDetail('Publish config record')
      }
    )
    // rollback 与 publish 共享 fail-closed 顺序，确保回退意图在任何状态变更前已形成 Audit 事实。
    .post(
      '/:id/rollback',
      async ({ params, body, headers }) => {
        const { auth, decision } = await requireConfigPolicy(deps, {
          headers,
          action: 'config:rollback',
          resource: `config:${params.id}`
        })
        await writeConfigAudit(deps, {
          actor: auth.actor,
          action: 'config:rollback',
          resource: `config:${params.id}`,
          decisionId: decision.id,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { toVersion: body.toVersion, reason: body.reason }
        })
        const result = await deps.config.rollback(params.id, {
          toVersion: body.toVersion,
          reason: body.reason,
          correlationId: auth.correlationId
        })
        if (!result.ok) throwConfigError(result.error, auth.correlationId)
        return { config: { id: result.value.id, status: result.value.status as 'rolled_back' } }
      },
      {
        params: configParamsSchema,
        body: configRollbackBodySchema,
        detail: protectedRouteDetail('Rollback config record')
      }
    )

/**
 * Internal apply-ack 路由只信任内部 token，并把服务回执收敛为统一 ConfigPort ack 输入。
 */
export const createConfigApplyAckRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/internal/v0/configs' }).post(
    '/:id/apply-ack',
    async ({ params, body, headers, request }) => {
      const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
      validateConfigInternalRequest(request, correlationId)
      const ackInput = normalizeAckInput(body)
      const result = await deps.config.applyAck(params.id, {
        version: ackInput.version,
        targetService: ackInput.targetService,
        status: ackInput.status,
        ...(ackInput.error ? { error: ackInput.error } : {}),
        correlationId
      })
      if (!result.ok) throwConfigError(result.error, correlationId)

      return {
        ack: {
          ackId: result.value.ackId,
          configId: params.id,
          configVersion: ackInput.version,
          ackedBy: ackInput.targetService,
          status: result.value.status,
          ackedAt: result.value.ackedAt,
          ...toAckResponseError(body)
        }
      }
    },
    {
      params: configParamsSchema,
      body: configApplyAckBodySchema,
      detail: { summary: 'Internal config apply acknowledgement' }
    }
  )
