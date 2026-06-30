import type { EnableDataPlaneSuccess } from './mnet-dataplane-support.ts'
import { enableDataPlaneProfile, requireDataPlaneDeps } from './mnet-dataplane-workflows.ts'
import { createPendingApprovalFlow } from './profile-approval-workflow.ts'
import { migrateLegacyCnProfileBeforeEnable } from './profile-enable-migration.ts'
import { canRequestEnable } from './profile-state-machine.ts'
import {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  type CHINA_PROFILE_VERSION,
  type ProfileWriteBody,
  isProfileWorkflowFailure,
  type KnownNetworkState,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

/** enable profile 的状态机检查；0.2.0 在 allow 时直接执行数据面编排，否则走审批恢复。 */
export async function requestEnableProfile(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: Extract<ProfileWriteBody['profileVersion'], `m-net-cn@${string}`>
    reason: string
  }
): Promise<
  | EnableDataPlaneSuccess
  | { status: 'pending_approval'; operationId: string; approvalId: string; correlationId: string }
  | ProfileWorkflowFailure
> {
  if (!canRequestEnable(input.state.status)) {
    return profileWorkflowFailure(
      409,
      'profile.enable.invalid_state',
      `cannot enable from ${input.state.status}`
    )
  }

  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-enable',
    `network:${input.networkId}`
  )
  if (policyResult.result === 'deny') {
    return profileWorkflowFailure(
      403,
      'policy.denied',
      `profile enable denied: ${policyResult.reasons.join(', ')}`
    )
  }

  if (policyResult.result === 'allow') {
    const migrated = await migrateLegacyCnProfileBeforeEnable(deps, input)
    if (isProfileWorkflowFailure(migrated)) return migrated
    if (!deps.listMembers) {
      return profileWorkflowFailure(
        503,
        'feature.unavailable',
        'data-plane orchestration features are not available'
      )
    }
    const dataPlaneDeps = requireDataPlaneDeps({
      profileStore: deps.profileStore,
      policyAuthorize: deps.policyAuthorize,
      ...(deps.dataPlane ? { dataPlane: deps.dataPlane } : {}),
      listMembers: deps.listMembers,
      ...(deps.events ? { events: deps.events } : {}),
      ...(deps.log ? { log: deps.log } : {}),
      ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {})
    })
    if (isProfileWorkflowFailure(dataPlaneDeps)) return dataPlaneDeps
    return enableDataPlaneProfile(dataPlaneDeps, {
      actor: input.actor,
      networkId: input.networkId,
      reason: input.reason,
      profileVersion: input.profileVersion as
        | typeof CHINA_DATA_PLANE_PROFILE_VERSION
        | 'm-net-cn@0.3.0'
    })
  }

  const pending = await createPendingApprovalFlow(deps, {
    actor: input.actor,
    networkId: input.networkId,
    state: input.state,
    profileVersion: input.profileVersion,
    reason: input.reason,
    policyDecisionId: policyResult.id,
    action: 'mnet.profile.enable',
    pendingStatus: 'enabling',
    requestedEvent: 'mnet.profile.enable.requested',
    requestedSubject: 'mnet.profile.enable.requested.v0',
    auditAction: 'mnet.profile.enable.request',
    failureLogMessage: `approval creation failed for network ${input.networkId}`
  })
  return pending.ok
    ? pending.value
    : profileWorkflowFailure(503, 'approval.create_failed', pending.error.message)
}
