import type { MNetAppDeps } from './deps.ts'
import { breakGlassFailClosed, getDataPlaneStores } from './mnet-dataplane-workflows.ts'
import { canDisable } from './profile-state-machine.ts'
import {
  type BreakGlassBody,
  type BreakGlassDeps,
  correlationId,
  DEFAULT_PROFILE_VERSION,
  isProfileWorkflowFailure,
  type ProfileWorkflowFailure,
  profileWorkflowFailure,
  toKnownState
} from './profile-workflow-types.ts'

/**
 * break-glass 依赖守卫；必须同时具备 profileStore、policyAuthorize、profileDisablePolicy。
 */
export function requireBreakGlassDeps(
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'policyAuthorize'
    | 'profileDisablePolicy'
    | 'policyHealthCheck'
    | 'events'
    | 'log'
    | 'networkUpdater'
    | 'listMembers'
    | 'dataPlane'
  >
): BreakGlassDeps | ProfileWorkflowFailure {
  if (!deps.profileStore || !deps.policyAuthorize || !deps.profileDisablePolicy) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'break-glass features are not available'
    )
  }
  return {
    profileStore: deps.profileStore,
    policyAuthorize: deps.policyAuthorize,
    profileDisablePolicy: deps.profileDisablePolicy,
    ...(deps.policyHealthCheck ? { policyHealthCheck: deps.policyHealthCheck } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {}),
    ...(deps.listMembers ? { listMembers: deps.listMembers } : {}),
    ...(deps.dataPlane ? { dataPlane: deps.dataPlane } : {})
  }
}

/**
 * break-glass 禁用是 security-admin 的紧急恢复路径：
 * 在 policy 不可用时仍可执行，但必须记录完整审计链。
 * 返回值可能是成功响应或 tagged failure，路由层负责最终 return。
 */
export async function executeBreakGlassDisable(
  deps: BreakGlassDeps,
  input: {
    actor: string
    networkId: string
    body: BreakGlassBody
  }
) {
  if (input.actor !== 'security-admin') {
    await deps.log?.writeAudit(
      input.actor,
      'mnet.profile.disable.break-glass.denied',
      `network:${input.networkId}`,
      'deny',
      undefined,
      { reason: 'actor is not security-admin' }
    )
    return profileWorkflowFailure(
      403,
      'break-glass.forbidden',
      'only security-admin may use break-glass disable'
    )
  }

  const rawState = await deps.profileStore.getNetworkState(input.networkId)
  if (!rawState) return profileWorkflowFailure(404, 'network.not_found', 'network not found')
  const state = toKnownState(rawState)
  if (!state) {
    return profileWorkflowFailure(
      503,
      'profile.state_invalid',
      `unknown profile state ${rawState.status}`
    )
  }

  if (!canDisable(state.status)) {
    return profileWorkflowFailure(
      409,
      'break-glass.invalid_state',
      `cannot break-glass disable from ${state.status}`
    )
  }

  let approvalDegraded = false
  let degradationSource: string | undefined
  if (deps.policyHealthCheck) {
    const health = await deps.policyHealthCheck.checkHealth()
    if (!health.healthy) {
      approvalDegraded = true
      degradationSource = 'policy-health-check'
    }
  }

  const emergencyReason = input.body.emergencyReason.trim()
  if (!emergencyReason && !approvalDegraded) {
    return profileWorkflowFailure(
      400,
      'reason.missing',
      'emergency reason is required when approval is healthy'
    )
  }

  const breakGlassCorrelationId = correlationId()
  const auditId = correlationId()
  const fullLogId = correlationId()

  let policyDecisionId: string | undefined
  try {
    const disablePolicyResult = await deps.policyAuthorize.authorize(
      input.actor,
      'network:profile-disable',
      `network:${input.networkId}`
    )
    if (disablePolicyResult.result === 'deny') {
      return profileWorkflowFailure(
        403,
        'policy.denied',
        `profile disable denied: ${disablePolicyResult.reasons.join(', ')}`
      )
    }
    policyDecisionId = disablePolicyResult.id
  } catch {
    if (!approvalDegraded) {
      return profileWorkflowFailure(
        503,
        'policy.unavailable',
        'policy service is not available and no approval degradation detected'
      )
    }
  }

  const breakGlassReason = `break-glass: ${emergencyReason || 'approval-degraded'}`
  await deps.log?.writeAudit(
    input.actor,
    'mnet.profile.disable.break-glass.emergency',
    `network:${input.networkId}`,
    'success',
    breakGlassCorrelationId,
    {
      emergencyReason: emergencyReason || 'approval-degraded',
      approvalDegraded,
      degradationSource: degradationSource ?? null,
      auditId,
      policyDecisionId: policyDecisionId ?? null
    }
  )
  await deps.log?.writeFull(
    'warn',
    `break-glass disable executed for network ${input.networkId}`,
    breakGlassCorrelationId,
    {
      emergencyReason: emergencyReason || 'approval-degraded',
      approvalDegraded,
      degradationSource: degradationSource ?? null,
      fullLogId,
      actor: input.actor
    }
  )
  await deps.profileStore.setNetworkState(input.networkId, {
    profileVersion: DEFAULT_PROFILE_VERSION,
    status: 'disabled'
  })
  await deps.profileStore.recordTransition({
    networkId: input.networkId,
    fromVersion: state.profileVersion,
    toVersion: DEFAULT_PROFILE_VERSION,
    fromStatus: state.status,
    toStatus: 'disabled',
    actor: input.actor,
    reason: breakGlassReason,
    correlationId: breakGlassCorrelationId,
    ...(policyDecisionId ? { policyDecisionId } : {})
  })
  await deps.networkUpdater?.setProfileVersion(input.networkId, DEFAULT_PROFILE_VERSION)
  if (deps.listMembers) {
    const dataPlane = getDataPlaneStores(deps.dataPlane)
    if (!dataPlane) {
      return profileWorkflowFailure(
        503,
        'feature.unavailable',
        'data-plane stores are not available'
      )
    }
    const failClosed = await breakGlassFailClosed(
      {
        profileStore: deps.profileStore,
        policyAuthorize: deps.policyAuthorize,
        listMembers: deps.listMembers,
        dataPlane,
        ...(deps.events ? { events: deps.events } : {}),
        ...(deps.log ? { log: deps.log } : {}),
        ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {})
      },
      { actor: input.actor, networkId: input.networkId, reason: breakGlassReason }
    )
    if (isProfileWorkflowFailure(failClosed)) return failClosed
  }
  await deps.events?.publish(
    'mnet.profile.disable.requested.v0',
    'mnet.profile.disable.requested',
    {
      networkId: input.networkId,
      fromProfileVersion: state.profileVersion,
      toProfileVersion: DEFAULT_PROFILE_VERSION,
      actor: input.actor,
      policyDecisionId: policyDecisionId ?? breakGlassCorrelationId,
      correlationId: breakGlassCorrelationId,
      reason: breakGlassReason,
      controlPlaneOnly: true
    },
    breakGlassCorrelationId
  )
  await deps.events?.publish(
    'mnet.profile.disabled.v0',
    'mnet.profile.disabled',
    {
      networkId: input.networkId,
      fromProfileVersion: state.profileVersion,
      toProfileVersion: DEFAULT_PROFILE_VERSION,
      actor: input.actor,
      policyDecisionId: policyDecisionId ?? breakGlassCorrelationId,
      correlationId: breakGlassCorrelationId,
      reason: breakGlassReason,
      controlPlaneOnly: true
    },
    breakGlassCorrelationId
  )
  await deps.log?.writeAudit(
    input.actor,
    'mnet.profile.disable.break-glass.executed',
    `network:${input.networkId}`,
    'success',
    breakGlassCorrelationId,
    { auditId, fullLogId }
  )

  return {
    operationId: breakGlassCorrelationId,
    profileVersion: DEFAULT_PROFILE_VERSION,
    status: 'disabled' as const,
    approvalDegraded,
    auditId,
    fullLogId,
    correlationId: breakGlassCorrelationId,
    ...(degradationSource ? { degradationSource } : {})
  }
}

export type { ProfileWorkflowFailure }
/** 重新导出，保持 profile-routes.ts 的 import 路径不变。 */
export { isProfileWorkflowFailure }
