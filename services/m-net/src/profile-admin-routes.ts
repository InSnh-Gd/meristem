import { Elysia } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { canResume, type ProfileState } from './profile-state-machine.ts'
import { internalError, requireInternal } from './route-helpers.ts'
import { operationIdParamsSchema } from './route-schemas.ts'

/**
 * M-Policy 内部回调只允许经内部信道恢复或拒绝挂起操作，避免外部 API 直接操纵审批结果。
 */
export function createProfileAdminRoutes(
  deps: Pick<MNetAppDeps, 'profileStore' | 'suspendedOps' | 'networkUpdater' | 'events' | 'log'>
) {
  return new Elysia({ prefix: '/internal/v0' })
    .post(
      '/network-profile-operations/:id/resume',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        if (!deps.suspendedOps || !deps.profileStore) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'profile features are not available'
          })
        }

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp)
          return internalError(status, 404, {
            code: 'operation.not_found',
            message: 'suspended operation not found'
          })
        if (suspendedOp.status !== 'suspended')
          return internalError(status, 409, {
            code: 'operation.not_suspended',
            message: 'operation is not suspended'
          })

        const now = new Date()
        if (new Date(suspendedOp.expiresAt) < now) {
          await deps.suspendedOps.transition(params.id, 'expired', 'operation expired')
          return internalError(status, 409, {
            code: 'operation.expired',
            message: 'suspended operation expired'
          })
        }

        // 检查陈旧状态：当前 profile 必须匹配 from_profile_version
        const state = await deps.profileStore.getNetworkState(suspendedOp.networkId)
        if (!state || state.profileVersion !== suspendedOp.fromProfileVersion) {
          await deps.suspendedOps.transition(
            params.id,
            'resume_failed',
            'stale state: current profile does not match expected'
          )
          await deps.events?.publish(
            'mnet.profile.apply_failed.v0',
            'mnet.profile.apply_failed',
            {
              networkId: suspendedOp.networkId,
              fromProfileVersion: suspendedOp.fromProfileVersion,
              toProfileVersion: suspendedOp.toProfileVersion,
              actor: 'system',
              policyDecisionId: suspendedOp.policyDecisionId,
              operationId: suspendedOp.id,
              correlationId: suspendedOp.correlationId,
              reason: 'stale_state',
              controlPlaneOnly: true
            },
            suspendedOp.correlationId
          )
          await deps.log?.writeTimeline(
            `profile apply failed for network ${suspendedOp.networkId}`,
            'mnet.profile.apply_failed',
            suspendedOp.correlationId
          )
          await deps.log?.writeAudit(
            'system',
            'mnet.profile.enable.failure',
            `network:${suspendedOp.networkId}`,
            'failure',
            suspendedOp.correlationId,
            { reason: 'stale_state' }
          )
          return internalError(status, 409, {
            code: 'resume.stale_state',
            message: 'network profile has changed since operation was created'
          })
        }

        // Enforce state machine: can only resume from enabling state
        if (!canResume(state.status as ProfileState)) {
          await deps.suspendedOps.transition(
            params.id,
            'resume_failed',
            `invalid state for resume: ${state.status}`
          )
          await deps.events?.publish(
            'mnet.profile.apply_failed.v0',
            'mnet.profile.apply_failed',
            {
              networkId: suspendedOp.networkId,
              fromProfileVersion: suspendedOp.fromProfileVersion,
              toProfileVersion: suspendedOp.toProfileVersion,
              actor: 'system',
              policyDecisionId: suspendedOp.policyDecisionId,
              operationId: suspendedOp.id,
              correlationId: suspendedOp.correlationId,
              reason: `state is ${state.status}, not enabling`,
              controlPlaneOnly: true
            },
            suspendedOp.correlationId
          )
          await deps.log?.writeAudit(
            'system',
            'mnet.profile.enable.failure',
            `network:${suspendedOp.networkId}`,
            'failure',
            suspendedOp.correlationId,
            { reason: `state is ${state.status}, not enabling` }
          )
          return internalError(status, 409, {
            code: 'resume.invalid_state',
            message: 'network is not in enabling state'
          })
        }

        // 应用 profile 变更
        await deps.profileStore.setNetworkState(suspendedOp.networkId, {
          profileVersion: suspendedOp.toProfileVersion,
          status: 'enabled'
        })
        await deps.networkUpdater?.setProfileVersion(
          suspendedOp.networkId,
          suspendedOp.toProfileVersion
        )
        await deps.profileStore.recordTransition({
          networkId: suspendedOp.networkId,
          fromVersion: suspendedOp.fromProfileVersion,
          toVersion: suspendedOp.toProfileVersion,
          fromStatus: 'enabling',
          toStatus: 'enabled',
          actor: 'system',
          reason: 'approved resume',
          policyDecisionId: suspendedOp.policyDecisionId,
          correlationId: suspendedOp.correlationId
        })
        await deps.suspendedOps.transition(params.id, 'resumed')

        await deps.events?.publish(
          'mnet.profile.enabled.v0',
          'mnet.profile.enabled',
          {
            networkId: suspendedOp.networkId,
            fromProfileVersion: suspendedOp.fromProfileVersion,
            toProfileVersion: suspendedOp.toProfileVersion,
            actor: 'system',
            policyDecisionId: suspendedOp.policyDecisionId,
            operationId: suspendedOp.id,
            correlationId: suspendedOp.correlationId,
            reason: suspendedOp.reason ?? 'approved resume',
            controlPlaneOnly: true
          },
          suspendedOp.correlationId
        )
        await deps.log?.writeTimeline(
          `profile enabled for network ${suspendedOp.networkId}`,
          'mnet.profile.enabled',
          suspendedOp.correlationId
        )
        await deps.log?.writeFull(
          'info',
          `profile enabled for network ${suspendedOp.networkId}`,
          suspendedOp.correlationId,
          { profileVersion: suspendedOp.toProfileVersion, operationId: suspendedOp.id }
        )
        await deps.log?.writeAudit(
          'system',
          'mnet.profile.enable.resume.attempt',
          `network:${suspendedOp.networkId}`,
          'success',
          suspendedOp.correlationId
        )
        await deps.log?.writeAudit(
          'system',
          'mnet.profile.enable.success',
          `network:${suspendedOp.networkId}`,
          'success',
          suspendedOp.correlationId,
          { profileVersion: suspendedOp.toProfileVersion }
        )

        return { status: 'resumed', operationId: params.id }
      },
      {
        params: operationIdParamsSchema
      }
    )
    .post(
      '/network-profile-operations/:id/reject',
      async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        if (!deps.suspendedOps || !deps.profileStore) {
          return internalError(status, 503, {
            code: 'feature.unavailable',
            message: 'profile features are not available'
          })
        }

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp)
          return internalError(status, 404, {
            code: 'operation.not_found',
            message: 'suspended operation not found'
          })
        if (suspendedOp.status !== 'suspended')
          return internalError(status, 409, {
            code: 'operation.not_suspended',
            message: 'operation is not suspended'
          })

        await deps.profileStore.setNetworkState(suspendedOp.networkId, {
          profileVersion: suspendedOp.fromProfileVersion,
          status: 'disabled'
        })
        await deps.profileStore.recordTransition({
          networkId: suspendedOp.networkId,
          fromVersion: suspendedOp.fromProfileVersion,
          toVersion: suspendedOp.toProfileVersion,
          fromStatus: 'enabling',
          toStatus: 'disabled',
          actor: 'system',
          reason: 'approval rejected',
          policyDecisionId: suspendedOp.policyDecisionId,
          correlationId: suspendedOp.correlationId
        })
        await deps.suspendedOps.transition(params.id, 'rejected', 'approval rejected')

        await deps.events?.publish(
          'mnet.profile.enable.canceled.v0',
          'mnet.profile.enable.canceled',
          {
            networkId: suspendedOp.networkId,
            fromProfileVersion: suspendedOp.fromProfileVersion,
            toProfileVersion: suspendedOp.toProfileVersion,
            actor: 'system',
            policyDecisionId: suspendedOp.policyDecisionId,
            operationId: suspendedOp.id,
            correlationId: suspendedOp.correlationId,
            reason: 'approval rejected',
            controlPlaneOnly: true
          },
          suspendedOp.correlationId
        )
        await deps.log?.writeTimeline(
          `profile enable canceled for network ${suspendedOp.networkId}`,
          'mnet.profile.enable.canceled',
          suspendedOp.correlationId
        )
        await deps.log?.writeAudit(
          'system',
          'mnet.profile.enable.cancel',
          `network:${suspendedOp.networkId}`,
          'canceled',
          suspendedOp.correlationId
        )

        return { status: 'rejected', operationId: params.id }
      },
      {
        params: operationIdParamsSchema
      }
    )
}
