import { Elysia, t } from 'elysia'
import { apiErrorSchema, protectedResponse, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  facadeFeatureUnavailable,
  runFacadeRead,
  runFacadeWrite
} from './facade-support.ts'

/**
 * Core 公开 facade：全局默认 Profile 读写与批量迁移。
 * Core 只做认证、授权与错误收敛；真实数据与状态仍由 M-Net 公开 HTTP API 拥有。
 */
export function globalDefaultsFacadeRoutes(deps: CoreDeps) {
  const defaultsReader = deps.globalDefaultsReader
  const defaultsWriter = deps.globalDefaultsWriter
  const switchWriter = deps.profileSwitchWriter

  // 端口未接线时返回 503
  if (!defaultsReader || !defaultsWriter || !switchWriter) {
    const defaultsUnavailable = facadeFeatureUnavailable('global defaults not wired')
    const switchUnavailable = facadeFeatureUnavailable('profile switch not wired')
    const notWired = new Elysia()
      .get('/api/v0/networks/profile-defaults', ({ set }) => {
        set.status = 503
        return defaultsUnavailable
      })
      .put('/api/v0/networks/profile-defaults', ({ set }) => {
        set.status = 503
        return defaultsUnavailable
      })
      .post('/api/v0/networks/profile-switches/plan', ({ set }) => {
        set.status = 503
        return switchUnavailable
      })
      .post('/api/v0/networks/profile-switches/:operationId/apply', ({ set }) => {
        set.status = 503
        return switchUnavailable
      })
      .post('/api/v0/networks/profile-switches/:operationId/resume', ({ set }) => {
        set.status = 503
        return switchUnavailable
      })
      .post('/api/v0/networks/profile-switches/:operationId/rollback', ({ set }) => {
        set.status = 503
        return switchUnavailable
      })
    return notWired
  }

  // ── 读取全局默认 ──────────────────────────────────────────────────────
  const getProfileDefaults = async (headers: Record<string, string | undefined>) => {
    return runFacadeRead(deps, {
      headers,
      action: defaultsReader.requiredPermission,
      resource: 'network:profile-defaults',
      run: (_auth, ctx) => defaultsReader.getDefaults(ctx)
    })
  }

  /** facade 写操作都共用同一套认证、授权、上下文构建与错误收敛。 */
  const runWrite = async <T>(input: {
    headers: Record<string, string | undefined>
    action: import('../../../../packages/contracts/src/index.ts').Permission
    resource: string
    run: (
      ctx: import('./facade-support.ts').FacadeWriterContext
    ) => Promise<import('./facade-support.ts').FacadeServiceResult<T>>
  }) => {
    return runFacadeWrite(deps, {
      headers: input.headers,
      action: input.action,
      resource: input.resource,
      run: (_auth, ctx) => input.run(ctx)
    })
  }

  return (
    new Elysia()
      .get(
        '/api/v0/networks/profile-defaults',
        async ({ headers }) => getProfileDefaults(headers),
        {
          response: protectedResponse(
            t.Object({
              defaultProfileVersion: t.String(),
              globalSwitchState: t.Union([
                t.Literal('idle'),
                t.Literal('planned'),
                t.Literal('applying'),
                t.Literal('applied'),
                t.Literal('rolled_back'),
                t.Literal('failed')
              ]),
              updatedAt: t.String(),
              switchOperationId: t.Optional(t.String())
            }),
            { 401: apiErrorSchema, 403: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Read global profile defaults through Core facade')
        }
      )
      // ── 设置全局默认 ──────────────────────────────────────────────────────
      .put(
        '/api/v0/networks/profile-defaults',
        async ({ body, headers }) => {
          return runWrite({
            headers,
            action: defaultsWriter.requiredPermission,
            resource: 'network:profile-defaults',
            run: ctx =>
              defaultsWriter.setDefaults(
                {
                  profileVersion: body.profileVersion,
                  reason: body.reason,
                  idempotencyKey: body.idempotencyKey
                },
                ctx
              )
          })
        },
        {
          body: t.Object({
            profileVersion: t.String({ minLength: 1 }),
            reason: t.String({ minLength: 1 }),
            idempotencyKey: t.String({ minLength: 1 })
          }),
          response: protectedResponse(
            t.Object({
              operationId: t.String(),
              policyDecisionId: t.String(),
              auditId: t.String(),
              defaultProfileVersion: t.String()
            }),
            { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Set global profile defaults through Core facade')
        }
      )
      // ── 批量迁移规划 ──────────────────────────────────────────────────────
      .post(
        '/api/v0/networks/profile-switches/plan',
        async ({ body, headers }) => {
          const planBody: {
            targetProfileVersion: string
            batchSize?: number
            reason: string
            idempotencyKey: string
          } = {
            targetProfileVersion: body.targetProfileVersion,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey
          }
          if (body.batchSize !== undefined) {
            planBody.batchSize = body.batchSize
          }
          return runWrite({
            headers,
            action: switchWriter.planPermission,
            resource: 'network:profile-switches',
            run: ctx => switchWriter.plan(planBody, ctx)
          })
        },
        {
          body: t.Object({
            targetProfileVersion: t.String({ minLength: 1 }),
            batchSize: t.Optional(t.Number({ minimum: 1 })),
            reason: t.String({ minLength: 1 }),
            idempotencyKey: t.String({ minLength: 1 })
          }),
          response: protectedResponse(
            t.Object({
              operationId: t.String(),
              candidateCount: t.Number(),
              batches: t.Array(
                t.Object({
                  batchId: t.Number(),
                  networkIds: t.Array(t.String())
                })
              ),
              globalSwitchState: t.Literal('planned')
            }),
            { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Plan profile switch migration through Core facade')
        }
      )
      // ── 批量应用 ──────────────────────────────────────────────────────────
      .post(
        '/api/v0/networks/profile-switches/:operationId/apply',
        async ({ params, headers }) => {
          return runWrite({
            headers,
            action: switchWriter.applyPermission,
            resource: `network:profile-switch:${params.operationId}`,
            run: ctx => switchWriter.apply(params.operationId, ctx)
          })
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) }),
          response: protectedResponse(
            t.Object({
              operationId: t.String(),
              batchId: t.Number(),
              results: t.Array(
                t.Object({
                  networkId: t.String(),
                  previousProfileVersion: t.String(),
                  targetProfileVersion: t.String(),
                  status: t.Union([
                    t.Literal('applied'),
                    t.Literal('skipped'),
                    t.Literal('failed'),
                    t.Literal('rolled_back')
                  ]),
                  reason: t.Optional(t.String()),
                  auditId: t.Optional(t.String()),
                  correlationId: t.Optional(t.String())
                })
              ),
              globalSwitchState: t.Union([t.Literal('applied'), t.Literal('applying')])
            }),
            { 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Apply profile switch batch through Core facade')
        }
      )
      // ── 恢复 ──────────────────────────────────────────────────────────────
      .post(
        '/api/v0/networks/profile-switches/:operationId/resume',
        async ({ params, headers }) => {
          return runWrite({
            headers,
            action: switchWriter.resumePermission,
            resource: `network:profile-switch:${params.operationId}`,
            run: ctx => switchWriter.resume(params.operationId, ctx)
          })
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) }),
          response: protectedResponse(
            t.Object({
              operationId: t.String(),
              nextBatchId: t.Optional(t.Nullable(t.Number())),
              globalSwitchState: t.Union([t.Literal('applying'), t.Literal('applied')]),
              remainingBatches: t.Number()
            }),
            { 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Resume profile switch migration through Core facade')
        }
      )
      // ── 回滚 ──────────────────────────────────────────────────────────────
      .post(
        '/api/v0/networks/profile-switches/:operationId/rollback',
        async ({ params, headers }) => {
          return runWrite({
            headers,
            action: switchWriter.rollbackPermission,
            resource: `network:profile-switch:${params.operationId}`,
            run: ctx => switchWriter.rollback(params.operationId, {}, ctx)
          })
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) }),
          response: protectedResponse(
            t.Object({
              operationId: t.String(),
              rollbackResults: t.Array(
                t.Object({
                  networkId: t.String(),
                  previousProfileVersion: t.String(),
                  targetProfileVersion: t.String(),
                  status: t.Union([
                    t.Literal('applied'),
                    t.Literal('skipped'),
                    t.Literal('failed'),
                    t.Literal('rolled_back')
                  ]),
                  reason: t.Optional(t.String()),
                  auditId: t.Optional(t.String()),
                  correlationId: t.Optional(t.String())
                })
              ),
              globalSwitchState: t.Literal('rolled_back')
            }),
            { 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema, 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Rollback profile switch migration through Core facade')
        }
      )
  )
}
