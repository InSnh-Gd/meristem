import { Elysia } from 'elysia'
import { canDisable, canRequestEnable, type ProfileState } from './profile-state-machine.ts'
import type { MNetAppDeps } from './deps.ts'
import { externalApiError, verifyBearerAuth } from './route-helpers.ts'
import {
  networkIdParamsSchema,
  profileVersionParamsSchema,
  setNetworkProfileBodySchema
} from './route-schemas.ts'

const CHINA_PROFILE_VERSION = 'm-net-cn@0.1.0'

/**
 * 对外 REST API 只暴露 profile 查询与切换；JWT、M-Policy、M-Log、M-EventBus 顺序必须保持稳定。
 */
export function createProfileRoutes(
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'suspendedOps'
    | 'approvals'
    | 'policyAuthorize'
    | 'events'
    | 'log'
    | 'networkUpdater'
  >
) {
  return new Elysia({ prefix: '/api/v0' })
    .get('/network-profiles', async ({ headers, set }) => {
      const actor = await verifyBearerAuth(headers)
      if (!actor)
        return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
      if (!deps.profileStore || !deps.policyAuthorize)
        return externalApiError(
          set,
          503,
          'feature.unavailable',
          'profile features are not available'
        )

      const policyResult = await deps.policyAuthorize.authorize(
        actor,
        'network:profile-read',
        'network-profiles'
      )
      if (policyResult.result !== 'allow') {
        return externalApiError(
          set,
          403,
          'policy.denied',
          `read denied: ${policyResult.reasons.join(', ')}`
        )
      }

      const defs = await deps.profileStore.getDefinitions()
      return { profiles: defs }
    })
    .get(
      '/network-profiles/:profileVersion',
      async ({ params, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor)
          return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        if (!deps.profileStore || !deps.policyAuthorize)
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'profile features are not available'
          )

        const policyResult = await deps.policyAuthorize.authorize(
          actor,
          'network:profile-read',
          `network-profile:${params.profileVersion}`
        )
        if (policyResult.result !== 'allow') {
          return externalApiError(
            set,
            403,
            'policy.denied',
            `read denied: ${policyResult.reasons.join(', ')}`
          )
        }

        const def = await deps.profileStore.getDefinition(params.profileVersion)
        if (!def) return externalApiError(set, 404, 'profile.not_found', 'profile not found')
        return def
      },
      {
        params: profileVersionParamsSchema
      }
    )
    .post(
      '/networks/:id/profile',
      async ({ params, body, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor)
          return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        if (!deps.profileStore || !deps.suspendedOps || !deps.approvals || !deps.policyAuthorize) {
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'profile features are not available'
          )
        }

        const { profileVersion, reason } = body

        const state = await deps.profileStore.getNetworkState(params.id)
        if (!state) return externalApiError(set, 404, 'network.not_found', 'network not found')

        if (profileVersion === CHINA_PROFILE_VERSION) {
          const validation = canRequestEnable(state.status as ProfileState)
          if (!validation) {
            return externalApiError(
              set,
              409,
              'profile.enable.invalid_state',
              `cannot enable from ${state.status}`
            )
          }

          // Call M-Policy for authorization (fail-closed)
          if (!deps.policyAuthorize) {
            return externalApiError(
              set,
              503,
              'policy.unavailable',
              'policy service is not available'
            )
          }
          const policyResult = await deps.policyAuthorize.authorize(
            actor,
            'network:profile-enable',
            `network:${params.id}`
          )

          if (policyResult.result === 'deny') {
            return externalApiError(
              set,
              403,
              'policy.denied',
              `profile enable denied: ${policyResult.reasons.join(', ')}`
            )
          }

          // 创建挂起操作
          const suspendedOp = await deps.suspendedOps.create({
            policyDecisionId: policyResult.id,
            action: 'mnet.profile.enable',
            networkId: params.id,
            fromProfileVersion: state.profileVersion,
            toProfileVersion: profileVersion,
            requestedBy: actor,
            reason,
            correlationId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
          })

          // 创建 M-Policy 审批（operationId 必须是 suspendedOp.id，M-Policy 用它回调 M-Net resume）
          const approval = await deps.approvals.create({
            policyDecisionId: policyResult.id,
            originService: 'm-net',
            operationId: suspendedOp.id,
            requestedBy: actor,
            requiredAction: 'manual_review',
            quorumRequired: 1,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
          })

          // 审批创建失败：回滚并返回错误
          if (!approval.ok) {
            await deps.suspendedOps.transition(
              suspendedOp.id,
              'resume_failed',
              'approval creation failed'
            )
            await deps.log?.writeFull(
              'error',
              `approval creation failed for network ${params.id}`,
              suspendedOp.correlationId,
              { error: approval.error }
            )
            return externalApiError(set, 503, 'approval.create_failed', approval.error.message)
          }

          // 转换状态为 enabling
          await deps.profileStore.setNetworkState(params.id, {
            profileVersion: state.profileVersion,
            status: 'enabling'
          })
          await deps.profileStore.recordTransition({
            networkId: params.id,
            fromVersion: state.profileVersion,
            toVersion: profileVersion,
            fromStatus: state.status,
            toStatus: 'enabling',
            actor,
            reason,
            policyDecisionId: policyResult.id,
            correlationId: suspendedOp.correlationId
          })

          await deps.events?.publish(
            'mnet.profile.enable.requested.v0',
            'mnet.profile.enable.requested',
            {
              networkId: params.id,
              fromProfileVersion: state.profileVersion,
              toProfileVersion: profileVersion,
              actor,
              policyDecisionId: policyResult.id,
              approvalId: approval.ok ? approval.value.approvalId : undefined,
              operationId: suspendedOp.id,
              correlationId: suspendedOp.correlationId,
              reason,
              controlPlaneOnly: true
            },
            suspendedOp.correlationId
          )
          await deps.log?.writeTimeline(
            `profile enable requested for network ${params.id}`,
            'mnet.profile.enable.requested',
            suspendedOp.correlationId
          )
          await deps.log?.writeFull(
            'info',
            `profile enable requested for network ${params.id}`,
            suspendedOp.correlationId,
            { profileVersion, operationId: suspendedOp.id }
          )
          await deps.log?.writeAudit(
            actor,
            'mnet.profile.enable.request',
            `network:${params.id}`,
            'pending',
            suspendedOp.correlationId,
            { profileVersion, operationId: suspendedOp.id }
          )

          return {
            status: 'pending_approval',
            operationId: suspendedOp.id,
            approvalId: approval.ok ? approval.value.approvalId : undefined,
            correlationId: suspendedOp.correlationId
          }
        }

        // DISABLE flow: immediate with M-Policy allow + Audit before execution

        // Already in default profile with disabled status → no-op
        if (state.profileVersion === profileVersion && state.status === 'disabled') {
          return externalApiError(
            set,
            409,
            'profile.not_enabled',
            'network is already using default profile in disabled state'
          )
        }

        const validation = canDisable(state.status as ProfileState)
        if (!validation) {
          return externalApiError(
            set,
            409,
            'profile.disable.invalid_state',
            `cannot disable from ${state.status}`
          )
        }

        const disableCorrelationId = crypto.randomUUID()

        // M-Policy authorization (fail-closed)
        if (!deps.policyAuthorize) {
          return externalApiError(set, 503, 'policy.unavailable', 'policy service is not available')
        }
        const disablePolicy = await deps.policyAuthorize.authorize(
          actor,
          'network:profile-disable',
          `network:${params.id}`
        )
        if (disablePolicy.result !== 'allow') {
          return externalApiError(
            set,
            403,
            'policy.denied',
            `profile disable denied: ${disablePolicy.reasons.join(', ')}`
          )
        }

        // Audit before mutation
        await deps.log?.writeAudit(
          actor,
          'mnet.profile.disable.request',
          `network:${params.id}`,
          'allow',
          disableCorrelationId,
          {
            fromVersion: state.profileVersion,
            toVersion: profileVersion,
            policyDecisionId: disablePolicy.id
          }
        )

        await deps.profileStore.setNetworkState(params.id, {
          profileVersion,
          status: 'disabled'
        })
        await deps.profileStore.recordTransition({
          networkId: params.id,
          fromVersion: state.profileVersion,
          toVersion: profileVersion,
          fromStatus: state.status,
          toStatus: 'disabled',
          actor,
          reason
        })
        await deps.networkUpdater?.setProfileVersion(params.id, profileVersion)
        await deps.events?.publish(
          'mnet.profile.disable.requested.v0',
          'mnet.profile.disable.requested',
          {
            networkId: params.id,
            fromProfileVersion: state.profileVersion,
            toProfileVersion: profileVersion,
            actor,
            policyDecisionId: disablePolicy.id,
            correlationId: disableCorrelationId,
            reason,
            controlPlaneOnly: true
          },
          disableCorrelationId
        )
        await deps.events?.publish(
          'mnet.profile.disabled.v0',
          'mnet.profile.disabled',
          {
            networkId: params.id,
            fromProfileVersion: state.profileVersion,
            toProfileVersion: profileVersion,
            actor,
            policyDecisionId: disablePolicy.id,
            correlationId: disableCorrelationId,
            reason,
            controlPlaneOnly: true
          },
          disableCorrelationId
        )
        await deps.log?.writeTimeline(
          `profile disabled for network ${params.id}`,
          'mnet.profile.disabled',
          disableCorrelationId
        )
        await deps.log?.writeFull(
          'info',
          `profile disabled for network ${params.id}`,
          disableCorrelationId,
          { profileVersion }
        )
        await deps.log?.writeAudit(
          actor,
          'mnet.profile.disable.success',
          `network:${params.id}`,
          'success',
          disableCorrelationId,
          { profileVersion }
        )

        return { status: 'disabled', profileVersion, correlationId: disableCorrelationId }
      },
      {
        params: networkIdParamsSchema,
        body: setNetworkProfileBodySchema
      }
    )
}
