import type { MNetAppDeps } from './deps.ts'
import { canDisable, canRequestEnable } from './profile-state-machine.ts'
import {
  CHINA_PROFILE_VERSION,
  correlationId,
  DEFAULT_PROFILE_VERSION,
  expiresAtFromNow,
  isProfileWorkflowFailure,
  type KnownNetworkState,
  type ProfileReadDeps,
  profileWorkflowFailure,
  type ProfileWorkflowFailure,
  type ProfileWriteBody,
  type ProfileWriteDeps,
  toKnownState,
  type RouteSet
} from './profile-workflow-types.ts'

/**
 * 只读 profile 依赖守卫；返回 tagged failure 而非直接操作 Elysia response。
 */
export function requireProfileReadDeps(
  deps: Pick<MNetAppDeps, 'profileStore' | 'policyAuthorize'>
): ProfileReadDeps | ProfileWorkflowFailure {
  if (!deps.profileStore || !deps.policyAuthorize) {
    return profileWorkflowFailure(503, 'feature.unavailable', 'profile features are not available')
  }
  return {
    profileStore: deps.profileStore,
    policyAuthorize: deps.policyAuthorize
  }
}

/**
 * 写入 profile 依赖守卫；必须同时具备 profileStore、suspendedOps、approvals、policyAuthorize。
 */
export function requireProfileWriteDeps(
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'suspendedOps'
    | 'approvals'
    | 'policyAuthorize'
    | 'events'
    | 'log'
    | 'profileDisablePolicy'
    | 'networkUpdater'
  >
): ProfileWriteDeps | ProfileWorkflowFailure {
  if (!deps.profileStore || !deps.suspendedOps || !deps.approvals || !deps.policyAuthorize) {
    return profileWorkflowFailure(503, 'feature.unavailable', 'profile features are not available')
  }
  return {
    profileStore: deps.profileStore,
    suspendedOps: deps.suspendedOps,
    approvals: deps.approvals,
    policyAuthorize: deps.policyAuthorize,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.profileDisablePolicy ? { profileDisablePolicy: deps.profileDisablePolicy } : {}),
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {})
  }
}

/**
 * enable/disable 共用的审批流创建：创建 suspendedOp + approval + 事件 + 审计。
 */
async function createPendingApprovalFlow(
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

/** enable profile 的状态机检查、policy 授权和审批流创建。 */
async function requestEnableProfile(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof CHINA_PROFILE_VERSION
    reason: string
  }
) {
  if (!canRequestEnable(input.state.status)) {
    return profileWorkflowFailure(409, 'profile.enable.invalid_state', `cannot enable from ${input.state.status}`)
  }

  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-enable',
    `network:${input.networkId}`
  )
  if (policyResult.result === 'deny') {
    return profileWorkflowFailure(403, 'policy.denied', `profile enable denied: ${policyResult.reasons.join(', ')}`)
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

/** disable profile 走审批路径：状态机检查、policy 授权和审批流创建。 */
async function requestDisableWithApproval(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof DEFAULT_PROFILE_VERSION
    reason: string
  }
) {
  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-disable',
    `network:${input.networkId}`
  )
  if (policyResult.result === 'deny') {
    return profileWorkflowFailure(403, 'policy.denied', `profile disable denied: ${policyResult.reasons.join(', ')}`)
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

/** disable profile 立即执行路径：无需审批，直接状态转换 + 事件 + 审计。 */
async function disableImmediately(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof DEFAULT_PROFILE_VERSION
    reason: string
  }
) {
  const disableResult = await deps.policyAuthorize.authorize(
    input.actor,
    'network:profile-disable',
    `network:${input.networkId}`
  )
  if (disableResult.result !== 'allow') {
    return profileWorkflowFailure(403, 'policy.denied', `profile disable denied: ${disableResult.reasons.join(', ')}`)
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
    status: 'disabled' as const,
    profileVersion: input.profileVersion,
    correlationId: disableCorrelationId
  }
}

/**
 * 路由入口编排：根据 body 中的 profileVersion 分派到 enable 或 disable 流程。
 * 返回值可能是成功响应或 tagged failure，路由层负责最终 return。
 */
export async function requestNetworkProfileChange(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    body: ProfileWriteBody
  }
) {
  const rawState = await deps.profileStore.getNetworkState(input.networkId)
  if (!rawState) return profileWorkflowFailure(404, 'network.not_found', 'network not found')
  const state = toKnownState(rawState)
  if (!state) {
    return profileWorkflowFailure(503, 'profile.state_invalid', `unknown profile state ${rawState.status}`)
  }

  if (input.body.profileVersion === CHINA_PROFILE_VERSION) {
    return requestEnableProfile(deps, {
      actor: input.actor,
      networkId: input.networkId,
      state,
      profileVersion: input.body.profileVersion,
      reason: input.body.reason
    })
  }

  if (state.profileVersion === input.body.profileVersion && state.status === 'disabled') {
    return profileWorkflowFailure(409, 'profile.not_enabled', 'network is already using default profile in disabled state')
  }

  if (!canDisable(state.status)) {
    return profileWorkflowFailure(409, 'profile.disable.invalid_state', `cannot disable from ${state.status}`)
  }

  const disablePolicy = deps.profileDisablePolicy
    ? await deps.profileDisablePolicy.getPolicy()
    : null

  const result = disablePolicy?.requireApproval
    ? await requestDisableWithApproval(deps, {
        actor: input.actor,
        networkId: input.networkId,
        state,
        profileVersion: input.body.profileVersion,
        reason: input.body.reason
      })
    : await disableImmediately(deps, {
        actor: input.actor,
        networkId: input.networkId,
        state,
        profileVersion: input.body.profileVersion,
        reason: input.body.reason
      })

  return result
}

/** 重新导出，保持 profile-routes.ts 的 import 路径不变。 */
export { isProfileWorkflowFailure }
export type { ProfileWorkflowFailure, RouteSet }
