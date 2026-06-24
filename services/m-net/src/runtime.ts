import type {
  NodeJoinTicketStatus,
  NodeReachability,
  NodeStatus,
  SessionHeartbeatMessage
} from '../../../packages/contracts/src/index.ts'
import {
  isHeartbeatSuppressedByNodeControl,
  isOfflineTransitionSuppressedByNodeControl
} from './node-control-state-machine.ts'

export type RuntimeNodeSnapshot = {
  id: string
  mode: 'agent' | 'simulated'
  status: NodeStatus
  reachability: NodeReachability
  lastSeenAt?: string
  agentVersion?: string
}

export type HeartbeatTransition = {
  nextStatus: Extract<NodeStatus, 'healthy' | 'degraded'>
  nextReachability: 'reachable'
  nextLastSeenAt: string
  nextAgentVersion: string
  statusChanged: boolean
  reachabilityChanged: boolean
}

export type RecoveryCompletionEvidence = {
  nodeId: string
  previousStatus: 'recovering'
  nextStatus: Extract<NodeStatus, 'healthy' | 'degraded'>
  heartbeatTimestamp: string
  agentVersion: string
}

export type JoinTicketSnapshot = {
  status: NodeJoinTicketStatus
  expiresAt: string
}

export type JoinTicketRedeemability = 'redeemable' | 'expired' | 'redeemed' | 'revoked'

export type SessionAuthorization =
  | { ok: true; nodeId: string }
  | { ok: false; code: 'session.unauthenticated' | 'session.superseded'; message: string }

/**
 * 心跳驱动的在线状态转换必须保持纯函数化，这样 HTTP 路由、NATS 消费者和测试
 * 都能复用同一套规则，而不是在边界层各自复制条件判断。
 */
export function deriveHeartbeatTransition(
  node: RuntimeNodeSnapshot,
  heartbeat: SessionHeartbeatMessage
): HeartbeatTransition {
  const nextStatus = heartbeat.reportedStatus
  return {
    nextStatus,
    nextReachability: 'reachable',
    nextLastSeenAt: heartbeat.timestamp,
    nextAgentVersion: heartbeat.agentVersion,
    statusChanged: node.status !== nextStatus,
    reachabilityChanged: node.reachability !== 'reachable'
  }
}

/**
 * recover 是操作者动作，但完成条件来自 agent heartbeat；这里只提取可审计事实，
 * 副作用仍由 session lifecycle 统一写入 Timeline/Audit/Event。
 */
export function deriveRecoveryCompletionEvidence(
  node: RuntimeNodeSnapshot,
  heartbeat: SessionHeartbeatMessage,
  transition: HeartbeatTransition
): RecoveryCompletionEvidence | null {
  if (node.status !== 'recovering' || !transition.statusChanged) return null
  return {
    nodeId: node.id,
    previousStatus: 'recovering',
    nextStatus: transition.nextStatus,
    heartbeatTimestamp: heartbeat.timestamp,
    agentVersion: heartbeat.agentVersion
  }
}

/**
 * offline 回收同样保持纯函数判断：只依赖快照、当前时间和超时阈值，
 * 不把数据库或总线副作用混进状态规则里。
 */
export function shouldTransitionOffline(
  node: RuntimeNodeSnapshot,
  now: Date,
  timeoutMs: number
): boolean {
  if (node.mode !== 'agent') return false
  if (node.reachability !== 'reachable') return false
  if (
    node.status === 'offline' ||
    node.status === 'revoked' ||
    isOfflineTransitionSuppressedByNodeControl(node.status)
  ) {
    return false
  }
  if (!node.lastSeenAt) return false
  const lastSeenAt = Date.parse(node.lastSeenAt)
  if (Number.isNaN(lastSeenAt)) return false
  return now.getTime() - lastSeenAt >= timeoutMs
}

/**
 * 公网 Join URL 必须从统一配置推导，避免 Core、CLI 和文档对 session 路径产生漂移。
 */
export function buildJoinSessionUrl(publicUrl: string): string {
  const base = new URL(publicUrl)
  base.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/join/v0/session`
  base.search = ''
  base.hash = ''
  return base.toString()
}

/**
 * Join Ticket 可兑换性保持纯函数化，便于在 HTTP、WebSocket 和测试里复用同一条规则。
 */
export function joinTicketRedeemability(
  ticket: JoinTicketSnapshot,
  now: Date
): JoinTicketRedeemability {
  if (ticket.status === 'redeemed') return 'redeemed'
  if (ticket.status === 'revoked') return 'revoked'
  const expiresAt = Date.parse(ticket.expiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return 'expired'
  return 'redeemable'
}

/**
 * 运行态消息只接受“当前仍然是活动连接”的 session：
 * 一旦新连接顶替旧连接，旧连接后续 heartbeat/log/task.result 都必须立即失效。
 */
export function authorizeSessionMessage<_TSession>(
  nodeId: string | null | undefined,
  currentSessionId: string | null | undefined,
  activeSessionId: string | undefined
): SessionAuthorization {
  if (!nodeId) {
    return {
      ok: false,
      code: 'session.unauthenticated',
      message: 'session has not been authenticated'
    }
  }

  if (!currentSessionId || activeSessionId !== currentSessionId) {
    return {
      ok: false,
      code: 'session.superseded',
      message: 'session has been superseded by a newer connection'
    }
  }

  return { ok: true, nodeId }
}

/**
 * 断连回收不依赖“最后心跳时间”，因为 socket close 本身已经说明当前活动链路失效；
 * 但 superseded 的旧连接会在边界层先被过滤，不会走到这里。
 */
export function shouldTransitionOfflineOnDisconnect(node: RuntimeNodeSnapshot): boolean {
  if (node.mode !== 'agent') return false
  if (
    node.status === 'offline' ||
    node.status === 'revoked' ||
    isOfflineTransitionSuppressedByNodeControl(node.status)
  ) {
    return false
  }
  return true
}

/**
 * 节点被操作者显式 disable / isolate 后，heartbeat 只能更新观测事实，不能恢复运行态状态。
 */
export function isHeartbeatStatusSuppressed(node: RuntimeNodeSnapshot): boolean {
  return isHeartbeatSuppressedByNodeControl(node.status)
}
