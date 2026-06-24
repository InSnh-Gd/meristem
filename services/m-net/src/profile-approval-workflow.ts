import {
  correlationId,
  type DEFAULT_PROFILE_VERSION,
  expiresAtFromNow,
  type KnownNetworkState,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

/**
 * enable/disable 共用的审批流创建：创建 suspendedOp + approval + 事件 + 审计。
 */
export async function createPendingApprovalFlow(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: string
    reason: string
    policyDecisionId: string
    action: 'mnet.profile.enable' | 'mnet.profile.disable'
    pendingStatus: 'enabling' | 'disabling'
    requestedEvent: 'mnet.profile.enable.requested' | 'mnet.profile.disable.requested'
    requestedSubject: 'mnet.profile.enable.requested.v0' | 'mnet.profile.disable.requested.v0'
    auditAction: 'mnet.profile.enable.request' | 'mnet.profile.disable.request'
    failureLogMessage: string
  }
) {
  const flowCorrelationId = correlationId()
  const expiresAt = expiresAtFromNow()
  const suspendedOp = await deps.suspendedOps.create({
    policyDecisionId: input.policyDecisionId,
    action: input.action,
    networkId: input.networkId,
    fromProfileVersion: input.state.profileVersion,
    toProfileVersion: input.profileVersion,
    requestedBy: input.actor,
    reason: input.reason,
    correlationId: flowCorrelationId,
    idempotencyKey: correlationId(),
    expiresAt
  })

  const approval = await deps.approvals.create({
    policyDecisionId: input.policyDecisionId,
    originService: 'm-net',
    operationId: suspendedOp.id,
    requestedBy: input.actor,
    requiredAction: 'manual_review',
    quorumRequired: 1,
    expiresAt
  })

  if (!approval.ok) {
    await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', 'approval creation failed')
    await deps.log?.writeFull('error', input.failureLogMessage, suspendedOp.correlationId, {
      error: approval.error
    })
    return { ok: false as const, error: approval.error }
  }

  await deps.profileStore.setNetworkState(input.networkId, {
    profileVersion: input.state.profileVersion,
    status: input.pendingStatus
  })
  await deps.profileStore.recordTransition({
    networkId: input.networkId,
    fromVersion: input.state.profileVersion,
    toVersion: input.profileVersion,
    fromStatus: input.state.status,
    toStatus: input.pendingStatus,
    actor: input.actor,
    reason: input.reason,
    policyDecisionId: input.policyDecisionId,
    correlationId: suspendedOp.correlationId
  })

  await deps.events?.publish(
    input.requestedSubject,
    input.requestedEvent,
    {
      networkId: input.networkId,
      fromProfileVersion: input.state.profileVersion,
      toProfileVersion: input.profileVersion,
      actor: input.actor,
      policyDecisionId: input.policyDecisionId,
      approvalId: approval.value.approvalId,
      operationId: suspendedOp.id,
      correlationId: suspendedOp.correlationId,
      reason: input.reason,
      controlPlaneOnly: true
    },
    suspendedOp.correlationId
  )
  await deps.log?.writeTimeline(
    `${input.action} requested for network ${input.networkId}`,
    input.requestedEvent,
    suspendedOp.correlationId
  )
  await deps.log?.writeFull(
    'info',
    `${input.action} requested for network ${input.networkId}`,
    suspendedOp.correlationId,
    { profileVersion: input.profileVersion, operationId: suspendedOp.id }
  )
  await deps.log?.writeAudit(
    input.actor,
    input.auditAction,
    `network:${input.networkId}`,
    'pending',
    suspendedOp.correlationId,
    { profileVersion: input.profileVersion, operationId: suspendedOp.id }
  )

  return {
    ok: true as const,
    value: {
      status: 'pending_approval' as const,
      operationId: suspendedOp.id,
      approvalId: approval.value.approvalId,
      correlationId: suspendedOp.correlationId
    }
  }
}

/** disable profile 走审批路径：状态机检查、policy 授权和审批流创建。 */
export async function requestDisableWithApproval(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof DEFAULT_PROFILE_VERSION
    reason: string
  }
): Promise<
  | { status: 'pending_approval'; operationId: string; approvalId: string; correlationId: string }
  | ProfileWorkflowFailure
> {
  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-disable',
    `network:${input.networkId}`
  )
  if (policyResult.result === 'deny') {
    return profileWorkflowFailure(
      403,
      'policy.denied',
      `profile disable denied: ${policyResult.reasons.join(', ')}`
    )
  }

  const pending = await createPendingApprovalFlow(deps, {
    actor: input.actor,
    networkId: input.networkId,
    state: input.state,
    profileVersion: input.profileVersion,
    reason: input.reason,
    policyDecisionId: policyResult.id,
    action: 'mnet.profile.disable',
    pendingStatus: 'disabling',
    requestedEvent: 'mnet.profile.disable.requested',
    requestedSubject: 'mnet.profile.disable.requested.v0',
    auditAction: 'mnet.profile.disable.request',
    failureLogMessage: `disable approval creation failed for network ${input.networkId}`
  })
  return pending.ok
    ? pending.value
    : profileWorkflowFailure(503, 'approval.create_failed', pending.error.message)
}
