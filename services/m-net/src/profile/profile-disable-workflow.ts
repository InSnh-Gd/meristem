import { authorizeOr403 } from '../policy-guard.ts'
import { applyProfileTransition } from './profile-transition.ts'
import {
  correlationId,
  type DEFAULT_PROFILE_VERSION,
  type KnownNetworkState,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

/** disable profile 立即执行路径：无需审批，直接状态转换 + 事件 + 审计。 */
export async function disableImmediately(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof DEFAULT_PROFILE_VERSION
    reason: string
  }
): Promise<
  | { status: 'disabled'; profileVersion: typeof DEFAULT_PROFILE_VERSION; correlationId: string }
  | ProfileWorkflowFailure
> {
  const policyGuard = await authorizeOr403(deps.policyAuthorize, {
    actor: input.actor,
    action: 'network:profile-disable',
    resource: `network:${input.networkId}`,
    deniedPrefix: 'profile disable',
    denyOn: 'non-allow'
  })
  if (policyGuard.kind === 'denied') {
    return profileWorkflowFailure(policyGuard.status, policyGuard.code, policyGuard.message)
  }

  const disableCorrelationId = correlationId()
  await deps.log?.writeAudit(
    input.actor,
    'mnet.profile.disable.request',
    `network:${input.networkId}`,
    'allow',
    disableCorrelationId,
    {
      fromVersion: input.state.profileVersion,
      toVersion: input.profileVersion,
      policyDecisionId: policyGuard.policyDecisionId
    }
  )
  // 立即禁用 = disable_request + disable_success 两跳；目标状态由状态机表折叠得出。
  await applyProfileTransition(deps.profileStore, {
    networkId: input.networkId,
    fromState: input.state,
    actions: ['disable_request', 'disable_success'],
    stateProfileVersion: input.profileVersion,
    actor: input.actor,
    reason: input.reason
  })
  await deps.networkUpdater?.setProfileVersion(input.networkId, input.profileVersion)
  await deps.events?.publish(
    'mnet.profile.disable.requested.v0',
    'mnet.profile.disable.requested',
    {
      networkId: input.networkId,
      fromProfileVersion: input.state.profileVersion,
      toProfileVersion: input.profileVersion,
      actor: input.actor,
      policyDecisionId: policyGuard.policyDecisionId,
      correlationId: disableCorrelationId,
      reason: input.reason,
      controlPlaneOnly: true
    },
    disableCorrelationId
  )
  await deps.events?.publish(
    'mnet.profile.disabled.v0',
    'mnet.profile.disabled',
    {
      networkId: input.networkId,
      fromProfileVersion: input.state.profileVersion,
      toProfileVersion: input.profileVersion,
      actor: input.actor,
      policyDecisionId: policyGuard.policyDecisionId,
      correlationId: disableCorrelationId,
      reason: input.reason,
      controlPlaneOnly: true
    },
    disableCorrelationId
  )
  await deps.log?.writeTimeline(
    `profile disabled for network ${input.networkId}`,
    'mnet.profile.disabled',
    disableCorrelationId
  )
  await deps.log?.writeFull(
    'info',
    `profile disabled for network ${input.networkId}`,
    disableCorrelationId,
    { profileVersion: input.profileVersion }
  )
  await deps.log?.writeAudit(
    input.actor,
    'mnet.profile.disable.success',
    `network:${input.networkId}`,
    'success',
    disableCorrelationId,
    { profileVersion: input.profileVersion }
  )
  return {
    status: 'disabled',
    profileVersion: input.profileVersion,
    correlationId: disableCorrelationId
  }
}
