import { Elysia, t } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { externalApiError } from './route-helpers.ts'
import {
  isGlobalDefaultsFailure,
  requireDefaultsReadDeps,
  requireDefaultsWriteDeps,
  requireGlobalDefaultsActor,
  requireGlobalDefaultsPolicy,
  requireMigrationDeps,
  requireSwitchOperationResult
} from './global-defaults-support.ts'

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

          // 幂等性检查
          const existingResult =
            await defaultsDeps.globalDefaultsStore.getDefaultSetResultByIdempotencyKey(
              idempotencyKey
            )
          if (existingResult) {
            return existingResult
          }

          // 验证 profile 版本存在
          const defs = deps.profileStore ? await deps.profileStore.getDefinitions() : []
          const validDef = defs.find(d => d.profileVersion === profileVersion)
          if (!validDef) {
            return externalApiError(
              set,
              400,
              'profile.not_found',
              `unknown profile version: ${profileVersion}`
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

          const correlationId = crypto.randomUUID()
          const auditId = crypto.randomUUID()

          // 设置全局默认
          await defaultsDeps.globalDefaultsStore.setDefaultProfileVersion(profileVersion)

          const responseBody = {
            operationId: correlationId,
            policyDecisionId: policy.policyDecisionId,
            auditId,
            defaultProfileVersion: profileVersion
          }

          // 记录幂等
          await defaultsDeps.globalDefaultsStore.recordDefaultSetResult(
            idempotencyKey,
            responseBody
          )

          await deps.log?.writeTimeline(
            `global default profile set to ${profileVersion}`,
            'mnet.profile.defaults.set',
            correlationId
          )
          await deps.log?.writeFull(
            'info',
            `global default profile set to ${profileVersion} by ${actor}`,
            correlationId,
            { profileVersion, reason, idempotencyKey }
          )
          await deps.log?.writeAudit(
            actor,
            'mnet.profile.defaults.set',
            'network:profile-defaults',
            'success',
            auditId,
            { profileVersion, reason }
          )
          await deps.events?.publish(
            'mnet.profile.defaults.updated.v0',
            'mnet.profile.defaults.updated',
            {
              defaultProfileVersion: profileVersion,
              actor,
              reason,
              correlationId,
              controlPlaneOnly: true
            },
            correlationId
          )

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
          const actor = await requireGlobalDefaultsActor(headers, set)
          if (isGlobalDefaultsFailure(actor)) {
            return externalApiError(set, actor.status, actor.error.code, actor.error.message)
          }
          const migrationDeps = requireMigrationDeps(deps, set)
          if (isGlobalDefaultsFailure(migrationDeps)) {
            return externalApiError(
              set,
              migrationDeps.status,
              migrationDeps.error.code,
              migrationDeps.error.message
            )
          }

          const policy = await requireGlobalDefaultsPolicy(migrationDeps.policyAuthorize, {
            actor,
            action: 'network:profile-switch-plan',
            resource: 'network:profile-switches',
            deniedPrefix: 'plan',
            set
          })
          if (isGlobalDefaultsFailure(policy)) {
            return externalApiError(set, policy.status, policy.error.code, policy.error.message)
          }

          const result = await migrationDeps.migrationEngine.plan({
            targetProfileVersion: body.targetProfileVersion,
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
            batches: result.value.batches,
            globalSwitchState: 'planned' as const
          }
        },
        {
          body: t.Object({
            targetProfileVersion: t.String({ minLength: 1 }),
            batchSize: t.Optional(t.Number({ minimum: 1 })),
            reason: t.String({ minLength: 1 }),
            idempotencyKey: t.String({ minLength: 1 })
          })
        }
      )

      // ── 批量 apply ────────────────────────────────────────────────────
      .post(
        '/networks/profile-switches/:operationId/apply',
        async ({ params, headers, set }) => {
          const actor = await requireGlobalDefaultsActor(headers, set)
          if (isGlobalDefaultsFailure(actor)) {
            return externalApiError(set, actor.status, actor.error.code, actor.error.message)
          }
          const migrationDeps = requireMigrationDeps(deps, set)
          if (isGlobalDefaultsFailure(migrationDeps)) {
            return externalApiError(
              set,
              migrationDeps.status,
              migrationDeps.error.code,
              migrationDeps.error.message
            )
          }

          // M-Policy 检查
          const policy = await requireGlobalDefaultsPolicy(migrationDeps.policyAuthorize, {
            actor,
            action: 'network:profile-switch-apply',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'apply',
            set
          })
          if (isGlobalDefaultsFailure(policy)) {
            return externalApiError(set, policy.status, policy.error.code, policy.error.message)
          }

          const result = requireSwitchOperationResult(
            await migrationDeps.migrationEngine.apply(params.operationId, actor),
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
          const actor = await requireGlobalDefaultsActor(headers, set)
          if (isGlobalDefaultsFailure(actor)) {
            return externalApiError(set, actor.status, actor.error.code, actor.error.message)
          }
          const migrationDeps = requireMigrationDeps(deps, set)
          if (isGlobalDefaultsFailure(migrationDeps)) {
            return externalApiError(
              set,
              migrationDeps.status,
              migrationDeps.error.code,
              migrationDeps.error.message
            )
          }

          // M-Policy 检查
          const policy = await requireGlobalDefaultsPolicy(migrationDeps.policyAuthorize, {
            actor,
            action: 'network:profile-switch-resume',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'resume',
            set
          })
          if (isGlobalDefaultsFailure(policy)) {
            return externalApiError(set, policy.status, policy.error.code, policy.error.message)
          }

          const result = requireSwitchOperationResult(
            await migrationDeps.migrationEngine.resume(params.operationId, actor),
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
          const actor = await requireGlobalDefaultsActor(headers, set)
          if (isGlobalDefaultsFailure(actor)) {
            return externalApiError(set, actor.status, actor.error.code, actor.error.message)
          }
          const migrationDeps = requireMigrationDeps(deps, set)
          if (isGlobalDefaultsFailure(migrationDeps)) {
            return externalApiError(
              set,
              migrationDeps.status,
              migrationDeps.error.code,
              migrationDeps.error.message
            )
          }

          // M-Policy 检查（回滚是高权限操作）
          const policy = await requireGlobalDefaultsPolicy(migrationDeps.policyAuthorize, {
            actor,
            action: 'network:profile-switch-rollback',
            resource: `network:profile-switch:${params.operationId}`,
            deniedPrefix: 'rollback',
            set
          })
          if (isGlobalDefaultsFailure(policy)) {
            return externalApiError(set, policy.status, policy.error.code, policy.error.message)
          }

          const reason = body?.reason

          const result = requireSwitchOperationResult(
            await migrationDeps.migrationEngine.rollback(params.operationId, actor, reason),
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
