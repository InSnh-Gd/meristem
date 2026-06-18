import {
  correlationId,
  type DEFAULT_PROFILE_VERSION,
  type KnownNetworkState,
  type ProfileWriteDeps,
  type ProfileWorkflowFailure,
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
  const disableResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-disable',
    `network:${input.networkId}`
  )
  if (disableResult.result !== 'allow') {
    return profileWorkflowFailure(
      403,
      'policy.denied',
      `profile disable denied: ${disableResult.reasons.join(', ')}`
    )
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
      policyDecisionId: disableResult.id
    }
  )
  await deps.profileStore.setNetworkState(input.networkId, {
    profileVersion: input.profileVersion,
    status: 'disabled'
  })
  await deps.profileStore.recordTransition({
    networkId: input.networkId,
    fromVersion: input.state.profileVersion,
    toVersion: input.profileVersion,
    fromStatus: input.state.status,
    toStatus: 'disabled',
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
      policyDecisionId: disableResult.id,
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
      policyDecisionId: disableResult.id,
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
