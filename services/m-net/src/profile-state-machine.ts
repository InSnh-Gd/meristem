/**
 * M-Net 网络 Profile 状态机，只包含纯函数，无副作用、无 DB 访问。
 *
 * 状态转换规则依据 PHASE-13.md §6：
 *   disabled → enabling → enabled → disabling → disabled
 *   任何迁移失败 → failed
 *   failed → disabling → disabled
 *   failed → enabling → enabled
 */

export type ProfileState = 'disabled' | 'enabling' | 'enabled' | 'disabling' | 'failed'

export type ProfileAction =
  | 'enable_request'
  | 'enable_success'
  | 'enable_fail'
  | 'disable_request'
  | 'disable_success'
  | 'disable_fail'

/**
 * 根据当前状态和动作计算下一个状态。
 * 无法匹配的动作返回当前状态（无操作）。
 */
export function nextProfileState(current: ProfileState, action: ProfileAction): ProfileState {
  switch (current) {
    case 'disabled':
      if (action === 'enable_request') return 'enabling'
      return current

    case 'enabling':
      if (action === 'enable_success') return 'enabled'
      if (action === 'enable_fail') return 'failed'
      return current

    case 'enabled':
      if (action === 'disable_request') return 'disabling'
      return current

    case 'disabling':
      if (action === 'disable_success') return 'disabled'
      if (action === 'disable_fail') return 'failed'
      return current

    case 'failed':
      if (action === 'enable_request') return 'enabling'
      if (action === 'disable_request') return 'disabling'
      return current

    default:
      return current
  }
}

/**
 * disabled 或 failed 状态可请求启用 Profile。
 * failed → enabling 是 Phase-13 §6 指定的恢复路径。
 */
export function canRequestEnable(currentStatus: ProfileState): boolean {
  return currentStatus === 'disabled' || currentStatus === 'failed'
}

/**
 * enabled 或 failed 状态可以禁用 Profile。
 * failed 状态下的禁用属于风险恢复路径。
 */
export function canDisable(currentStatus: ProfileState): boolean {
  return currentStatus === 'enabled' || currentStatus === 'failed'
}

/**
 * 只有 enabling 状态可以执行 resume（恢复暂挂的启用操作）。
 */
export function canResume(currentStatus: ProfileState): boolean {
  return currentStatus === 'enabling'
}
