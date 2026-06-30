import type { MNetAppDeps } from './deps.ts'
import { requestDisableWithApproval } from './profile-approval-workflow.ts'
import { disableImmediately } from './profile-disable-workflow.ts'
import { requestEnableProfile } from './profile-enable-workflow.ts'
import { requireSupportedProfileVersion } from './migration-required-support.ts'
import { canDisable } from './profile-state-machine.ts'
import {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  CHINA_PROFILE_VERSION,
  DEFAULT_PROFILE_VERSION,
  isProfileWorkflowFailure,
  type ProfileReadDeps,
  type ProfileWorkflowFailure,
  type ProfileWriteBody,
  type ProfileWriteDeps,
  profileWorkflowFailure,
  type RouteSet,
  toKnownState
} from './profile-workflow-types.ts'

function isEnableTarget(
  profileVersion: ProfileWriteBody['profileVersion']
): profileVersion is 'm-net-cn@0.3.0' {
  return profileVersion === CHINA_PROFILE_VERSION
}

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
    | 'listMembers'
    | 'migrationEngine'
    | 'dataPlane'
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
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {}),
    ...(deps.listMembers ? { listMembers: deps.listMembers } : {}),
    ...(deps.migrationEngine ? { migrationEngine: deps.migrationEngine } : {}),
    ...(deps.dataPlane ? { dataPlane: deps.dataPlane } : {})
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
    return profileWorkflowFailure(
      503,
      'profile.state_invalid',
      `unknown profile state ${rawState.status}`
    )
  }

  const compatibility = await requireSupportedProfileVersion(
    deps.profileStore,
    input.body.profileVersion,
    state.profileVersion
  )
  if (compatibility !== true) return compatibility

  if (isEnableTarget(input.body.profileVersion)) {
    return requestEnableProfile(deps, {
      actor: input.actor,
      networkId: input.networkId,
      state,
      profileVersion: input.body.profileVersion,
      reason: input.body.reason
    })
  }

  if (state.profileVersion === input.body.profileVersion && state.status === 'disabled') {
    return profileWorkflowFailure(
      409,
      'profile.not_enabled',
      'network is already using default profile in disabled state'
    )
  }

  if (!canDisable(state.status)) {
    return profileWorkflowFailure(
      409,
      'profile.disable.invalid_state',
      `cannot disable from ${state.status}`
    )
  }

  const disablePolicy = deps.profileDisablePolicy
    ? await deps.profileDisablePolicy.getPolicy()
    : null
  const disableProfileVersion = DEFAULT_PROFILE_VERSION

  const result = disablePolicy?.requireApproval
    ? await requestDisableWithApproval(deps, {
        actor: input.actor,
        networkId: input.networkId,
        state,
        profileVersion: disableProfileVersion,
        reason: input.body.reason
      })
    : await disableImmediately(deps, {
        actor: input.actor,
        networkId: input.networkId,
        state,
        profileVersion: disableProfileVersion,
        reason: input.body.reason
      })

  return result
}

export type { ProfileWorkflowFailure, RouteSet }
/** 重新导出，保持 profile-routes.ts 的 import 路径不变。 */
export { isProfileWorkflowFailure }
