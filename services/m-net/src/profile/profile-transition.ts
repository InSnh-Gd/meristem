import { nextProfileState, type ProfileAction, type ProfileState } from './profile-state-machine.ts'
import type { ProfileStore } from './profile-workflow-types.ts'

/**
 * Profile 状态迁移的唯一收口（chokepoint）：
 * workflow 只声明状态机表动作（ProfileAction），目标状态一律由 `profile-state-machine`
 * 的转换表计算，`setNetworkState` + `recordTransition` 在这里一次性落库。
 * workflow 不再手写表内已管辖的状态字面量。
 *
 * 表外补偿路径（break-glass 直接禁用、审批拒绝回滚、pending 状态幂等恢复）
 * 不经过本收口，由各 workflow 保持直接写并注明原因。
 */

/** 按序折叠一组状态机动作，得到最终状态（如立即禁用 = disable_request + disable_success 两跳）。 */
export function foldProfileTransition(
  from: ProfileState,
  actions: readonly ProfileAction[]
): ProfileState {
  return actions.reduce(nextProfileState, from)
}

export type ProfileTransitionInput = {
  networkId: string
  /**
   * 迁移记录与动作折叠的逻辑起点。pending/immediate/admin 路径传真实当前状态；
   * dataplane enable success 传 pending enabling 逻辑源（fresh enable 隐式、resume 显式）。
   */
  fromState: { profileVersion: string; status: ProfileState }
  /** 状态机表动作序列，按序折叠决定最终状态。 */
  actions: readonly ProfileAction[]
  /** 写入网络状态的 profileVersion；pending 请求阶段保持当前版本不变。缺省沿用 fromState.profileVersion。 */
  stateProfileVersion?: string
  /** 迁移记录 toVersion。缺省与 stateProfileVersion 一致。 */
  transitionToVersion?: string
  actor: string
  reason: string
  policyDecisionId?: string
  correlationId?: string
}

export type AppliedProfileTransition = {
  fromStatus: ProfileState
  toStatus: ProfileState
  profileVersion: string
}

/** 计算目标状态并写入 store：状态事实（state + transition record）从这里发出。 */
export async function applyProfileTransition(
  profileStore: ProfileStore,
  input: ProfileTransitionInput
): Promise<AppliedProfileTransition> {
  const fromStatus = input.fromState.status
  const toStatus = foldProfileTransition(fromStatus, input.actions)
  const stateProfileVersion = input.stateProfileVersion ?? input.fromState.profileVersion
  const transitionToVersion = input.transitionToVersion ?? stateProfileVersion
  await profileStore.setNetworkState(input.networkId, {
    profileVersion: stateProfileVersion,
    status: toStatus
  })
  await profileStore.recordTransition({
    networkId: input.networkId,
    fromVersion: input.fromState.profileVersion,
    toVersion: transitionToVersion,
    fromStatus,
    toStatus,
    actor: input.actor,
    reason: input.reason,
    ...(input.policyDecisionId ? { policyDecisionId: input.policyDecisionId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {})
  })
  return { fromStatus, toStatus, profileVersion: stateProfileVersion }
}
