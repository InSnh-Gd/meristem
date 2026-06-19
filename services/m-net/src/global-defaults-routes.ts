import { Elysia, t } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import {
  requireAuthorizedMigrationContext,
  isGlobalDefaultsFailure,
  preflightSetGlobalDefaultProfile,
  requireDefaultsReadDeps,
  requireDefaultsWriteDeps,
  requireGlobalDefaultsActor,
  requireGlobalDefaultsPolicy,
  requireSwitchOperationResult,
  setGlobalDefaultProfile
} from './global-defaults-support.ts'
import { CHINA_DATA_PLANE_PROFILE_VERSION } from './mnet-dataplane-workflows.ts'
import { externalApiError } from './route-helpers.ts'

/**
 * 全局默认 Profile 与批量 switch 公开 REST API。
 * 只暴露查询、设置默认和批量迁移操作，M-Policy 检查所有写操作。
 */
export function createGlobalDefaultsRoutes(
  deps: Pick<
    MNetAppDeps,
    | 'globalDefaultsStore'
    | 'migrationEngine'
    | 'policyAuthorize'
    | 'log'
    | 'events'
    | 'profileStore'
  >
) {
  return (
    new Elysia({ prefix: '/api/v0' })
      // ── 全局默认 Profile 读写 ──────────────────────────────────────────
      .get('/networks/profile-defaults', async ({ headers, set }) => {
        const actor = await requireGlobalDefaultsActor(headers, set)
        if (isGlobalDefaultsFailure(actor)) {
          return externalApiError(set, actor.status, actor.error.code, actor.error.message)
        }
        const defaultsDeps = requireDefaultsReadDeps(deps, set)
        if (isGlobalDefaultsFailure(defaultsDeps)) {
          return externalApiError(
            set,
            defaultsDeps.status,
            defaultsDeps.error.code,
            defaultsDeps.error.message
          )
        }

        const defaultVersion = await defaultsDeps.globalDefaultsStore.getDefaultProfileVersion()
        const switchState = await defaultsDeps.globalDefaultsStore.getSwitchState()

        return {
          defaultProfileVersion: defaultVersion,
          globalSwitchState: switchState.state,
          updatedAt: switchState.updatedAt,
          switchOperationId: switchState.switchOperationId
        }
      })
      .put(
        '/networks/profile-defaults',
        async ({ body, headers, set }) => {
          const actor = await requireGlobalDefaultsActor(headers, set)
          if (isGlobalDefaultsFailure(actor)) {
            return externalApiError(set, actor.status, actor.error.code, actor.error.message)
          }
          const defaultsDeps = requireDefaultsWriteDeps(deps, set)
          if (isGlobalDefaultsFailure(defaultsDeps)) {
            return externalApiError(
              set,
              defaultsDeps.status,
              defaultsDeps.error.code,
              defaultsDeps.error.message
            )
          }

          const { profileVersion, reason, idempotencyKey } = body

          const preflight = await preflightSetGlobalDefaultProfile(
            {
              globalDefaultsStore: defaultsDeps.globalDefaultsStore,
              profileStore: deps.profileStore
            },
            { profileVersion, idempotencyKey }
          )
          if (preflight.kind === 'success') {
            return preflight.value
          }
          if (isGlobalDefaultsFailure(preflight)) {
            return externalApiError(
              set,
              preflight.status,
              preflight.error.code,
              preflight.error.message
            )
          }

          // M-Policy 检查（fail-closed）
          const policy = await requireGlobalDefaultsPolicy(defaultsDeps.policyAuthorize, {
            actor,
            action: 'network:profile-defaults-set',
            resource: 'network:profile-defaults',
            deniedPrefix: 'set defaults',
            set
          })
          if (isGlobalDefaultsFailure(policy)) {
            return externalApiError(set, policy.status, policy.error.code, policy.error.message)
          }
          const responseBody = await setGlobalDefaultProfile(
            {
              globalDefaultsStore: defaultsDeps.globalDefaultsStore,
              profileStore: deps.profileStore,
              migrationEngine: deps.migrationEngine,
              log: deps.log,
              events: deps.events
            },
            {
              actor,
              policyDecisionId: policy.policyDecisionId,
              profileVersion,
              reason,
              idempotencyKey
            }
          )
          if (isGlobalDefaultsFailure(responseBody)) {
            return externalApiError(
              set,
              responseBody.status,
              responseBody.error.code,
              responseBody.error.message
            )
          }

          return responseBody
        },
        {
          body: t.Object({
            profileVersion: t.String({ minLength: 1 }),
            reason: t.String({ minLength: 1 }),
            idempotencyKey: t.String({ minLength: 1 })
          })
        }
      )

      // ── 批量 switch 规划 ──────────────────────────────────────────────
      .post(
        '/networks/profile-switches/plan',
        async ({ body, headers, set }) => {
          const context = await requireAuthorizedMigrationContext(deps, {
            headers,
            set,
            action: 'network:profile-switch-plan',
            resource: 'network:profile-switches',
            deniedPrefix: 'plan'
          })
          if (isGlobalDefaultsFailure(context)) {
            return externalApiError(set, context.status, context.error.code, context.error.message)
          }

          const { migrationDeps } = context

          // 迁移 dry-run 默认指向生产数据面 Profile，保留显式传参以兼容已有调用方与契约测试。
          const targetProfileVersion = body.targetProfileVersion ?? CHINA_DATA_PLANE_PROFILE_VERSION

          const result = await migrationDeps.migrationEngine.plan({
            targetProfileVersion,
            batchSize: body.batchSize ?? 10,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey
          })

          if (!result.ok) {
            return externalApiError(set, 400, 'plan.failed', result.error)
          }

          return {
            operationId: result.value.operationId,
            candidateCount: result.value.candidateCount,
            candidates: result.value.candidates,
            batches: result.value.batches,
            globalSwitchState: 'planned' as const
          }
        },
        {
          body: t.Object({
            targetProfileVersion: t.Optional(t.String({ minLength: 1 })),
            batchSize: t.Optional(t.Number({ minimum: 1 })),
            reason: t.String({ minLength: 1 }),
            idempotencyKey: t.String({ minLength: 1 })
          })
        }
      )

      .get(
        '/networks/profile-switches/:operationId',
        async ({ params, headers, set }) => {
          const context = await requireAuthorizedMigrationContext(deps, {
            headers,
            set,
            action: 'network:profile-read',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'read migration status'
          })
          if (isGlobalDefaultsFailure(context)) {
            return externalApiError(set, context.status, context.error.code, context.error.message)
          }
          const result = await context.migrationDeps.migrationEngine.getStatus(params.operationId)
          if (!result.ok) return externalApiError(set, 404, 'switch.not_found', result.error)
          return result.value
        },
        { params: t.Object({ operationId: t.String({ minLength: 1 }) }) }
      )

      // ── 批量 apply ────────────────────────────────────────────────────
      .post(
        '/networks/profile-switches/:operationId/apply',
        async ({ params, headers, set }) => {
          const context = await requireAuthorizedMigrationContext(deps, {
            headers,
            set,
            action: 'network:profile-switch-apply',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'apply'
          })
          if (isGlobalDefaultsFailure(context)) {
            return externalApiError(set, context.status, context.error.code, context.error.message)
          }

          const result = requireSwitchOperationResult(
            await context.migrationDeps.migrationEngine.apply(params.operationId, context.actor),
            set
          )
          if (isGlobalDefaultsFailure(result)) {
            return externalApiError(set, result.status, result.error.code, result.error.message)
          }

          return {
            operationId: result.operationId,
            batchId: result.batchId,
            results: result.results,
            globalSwitchState: result.isComplete ? ('applied' as const) : ('applying' as const)
          }
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) })
        }
      )

      // ── 恢复 ───────────────────────────────────────────────────────────
      .post(
        '/networks/profile-switches/:operationId/resume',
        async ({ params, headers, set }) => {
          const context = await requireAuthorizedMigrationContext(deps, {
            headers,
            set,
            action: 'network:profile-switch-resume',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'resume'
          })
          if (isGlobalDefaultsFailure(context)) {
            return externalApiError(set, context.status, context.error.code, context.error.message)
          }

          const result = requireSwitchOperationResult(
            await context.migrationDeps.migrationEngine.resume(params.operationId, context.actor),
            set
          )
          if (isGlobalDefaultsFailure(result)) {
            return externalApiError(set, result.status, result.error.code, result.error.message)
          }

          return {
            operationId: result.operationId,
            nextBatchId: result.nextBatchId,
            globalSwitchState: result.isComplete ? ('applied' as const) : ('applying' as const),
            remainingBatches: result.remainingBatches
          }
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) })
        }
      )

      // ── 回滚 ───────────────────────────────────────────────────────────
      .post(
        '/networks/profile-switches/:operationId/rollback',
        async ({ params, body, headers, set }) => {
          const context = await requireAuthorizedMigrationContext(deps, {
            headers,
            set,
            action: 'network:profile-switch-rollback',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'rollback'
          })
          if (isGlobalDefaultsFailure(context)) {
            return externalApiError(set, context.status, context.error.code, context.error.message)
          }

          const reason = body?.reason

          const result = requireSwitchOperationResult(
            await context.migrationDeps.migrationEngine.rollback(
              params.operationId,
              context.actor,
              reason
            ),
            set
          )
          if (isGlobalDefaultsFailure(result)) {
            return externalApiError(set, result.status, result.error.code, result.error.message)
          }

          return {
            operationId: result.operationId,
            rollbackResults: result.rollbackResults,
            globalSwitchState: 'rolled_back' as const
          }
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) }),
          body: t.Optional(t.Object({ reason: t.String({ minLength: 1 }) }))
        }
      )
  )
}
