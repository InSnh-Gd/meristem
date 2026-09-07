import { authorizeOr403 } from './policy-guard.ts'
import type { ProfileAction } from './profile-state-machine.ts'
import { applyProfileTransition } from './profile-transition.ts'
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
 * pending 状态（enabling/disabling）由状态机表通过 request 动作计算，不再手写字面量。
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
    requestedEvent: 'mnet.profile.enable.requested' | 'mnet.profile.disable.requested'
    requestedSubject: 'mnet.profile.enable.requested.v0' | 'mnet.profile.disable.requested.v0'
    auditAction: 'mnet.profile.enable.request' | 'mnet.profile.disable.request'
    failureLogMessage: string
  }
) {
  const transitionAction: ProfileAction =
    input.action === 'mnet.profile.enable' ? 'enable_request' : 'disable_request'
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

  // pending 请求阶段网络保持当前 profileVersion，target 版本只写入迁移记录。
  await applyProfileTransition(deps.profileStore, {
    networkId: input.networkId,
    fromState: input.state,
    actions: [transitionAction],
    transitionToVersion: input.profileVersion,
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
  const policyGuard = await authorizeOr403(deps.policyAuthorize, {
    actor: input.actor,
    action: 'network:profile-disable',
    resource: `network:${input.networkId}`,
    deniedPrefix: 'profile disable',
    denyOn: 'deny-only'
  })
  if (policyGuard.kind === 'denied') {
    return profileWorkflowFailure(policyGuard.status, policyGuard.code, policyGuard.message)
  }

  const pending = await createPendingApprovalFlow(deps, {
    actor: input.actor,
    networkId: input.networkId,
    state: input.state,
    profileVersion: input.profileVersion,
    reason: input.reason,
    policyDecisionId: policyGuard.policyDecisionId,
    action: 'mnet.profile.disable',
    requestedEvent: 'mnet.profile.disable.requested',
    requestedSubject: 'mnet.profile.disable.requested.v0',
    auditAction: 'mnet.profile.disable.request',
    failureLogMessage: `disable approval creation failed for network ${input.networkId}`
  })
  return pending.ok
    ? pending.value
    : profileWorkflowFailure(503, 'approval.create_failed', pending.error.message)
}
