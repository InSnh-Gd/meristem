import type { NodeControlAction, NodeKind, NodeStatus } from '../../../packages/contracts/src/index.ts'

export type NodeControlTransition =
  | { ok: true; nextStatus: Extract<NodeStatus, 'disabled' | 'isolated' | 'recovering'> }
  | { ok: false; code: 'node.control.invalid_transition'; message: string }

export type NodeRoleSwitchDecision =
  | { ok: true; nextKind: NodeKind }
  | {
      ok: false
      code:
        | 'node.control.target_kind_required'
        | 'node.control.role_unchanged'
        | 'node.control.last_stem_required'
      message: string
    }

/**
 * 节点行政控制状态机保持纯函数：只根据当前状态和操作决定下一状态，
 * 不混入策略、数据库或日志副作用。
 */
export function deriveNodeControlTransition(
  currentStatus: NodeStatus,
  action: NodeControlAction
): NodeControlTransition {
  if (action === 'disable') {
    if (currentStatus === 'healthy' || currentStatus === 'degraded' || currentStatus === 'offline') {
      return { ok: true, nextStatus: 'disabled' }
    }
    return {
      ok: false,
      code: 'node.control.invalid_transition',
      message: `cannot disable node from ${currentStatus}`
    }
  }

  if (action === 'isolate') {
    if (currentStatus === 'healthy' || currentStatus === 'degraded' || currentStatus === 'offline') {
      return { ok: true, nextStatus: 'isolated' }
    }
    return {
      ok: false,
      code: 'node.control.invalid_transition',
      message: `cannot isolate node from ${currentStatus}`
    }
  }

  if (currentStatus === 'disabled' || currentStatus === 'isolated') {
    return { ok: true, nextStatus: 'recovering' }
  }

  return {
    ok: false,
    code: 'node.control.invalid_transition',
    message: `cannot recover node from ${currentStatus}`
  }
}

/** ponytail: role switching enforces only the current one-stem minimum, not a general topology planner. */
export function deriveNodeRoleSwitch(
  currentKind: NodeKind,
  targetKind: NodeKind | undefined,
  siblingStemCount: number
): NodeRoleSwitchDecision {
  if (!targetKind) {
    return {
      ok: false,
      code: 'node.control.target_kind_required',
      message: 'target kind is required for role switch'
    }
  }

  if (currentKind === targetKind) {
    return {
      ok: false,
      code: 'node.control.role_unchanged',
      message: 'node already has requested role'
    }
  }

  if (currentKind === 'stem' && targetKind === 'leaf' && siblingStemCount <= 0) {
    return {
      ok: false,
      code: 'node.control.last_stem_required',
      message: 'network requires at least one stem member'
    }
  }

  return { ok: true, nextKind: targetKind }
}

/**
 * disabled / isolated 代表操作者显式压制运行态恢复；heartbeat 只能记录事实，不能改写状态。
 */
export function isHeartbeatSuppressedByNodeControl(status: NodeStatus): boolean {
  return status === 'disabled' || status === 'isolated'
}

/**
 * recovering 是等待下一次有效 heartbeat 的中间态；在此之前也不允许被离线扫描覆盖。
 */
export function isOfflineTransitionSuppressedByNodeControl(status: NodeStatus): boolean {
  return status === 'disabled' || status === 'isolated' || status === 'recovering'
}

/**
 * 被行政控制摘除的节点不能继续出现在正常 peer path 中，避免控制面误把它重新编入地图。
 */
export function isNodeExcludedFromPeerPaths(status: NodeStatus): boolean {
  return (
    status === 'disabled' ||
    status === 'isolated' ||
    status === 'recovering' ||
    status === 'revoked'
  )
}
