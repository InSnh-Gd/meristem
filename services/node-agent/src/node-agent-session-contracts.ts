import type { NodeAgentRuntimeDesiredSidecar } from '../../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/index.ts'

/** 会话恢复成功后由控制面确认的最小载荷。 */
export type SessionAckMessage = {
  type: 'session.ack'
  sessionId: string
  serverTime: string
}

/** Join Ticket 被拒绝时返回的显式失败结果。 */
export type JoinRejectedResult = {
  kind: 'join.rejected'
  reason: string
}

/** Join Ticket 兑换成功后保留的节点会话身份。 */
export type JoinRedeemSuccess = {
  kind: 'join.accepted'
  nodeToken: string
  controlUrl: string
  nodeId: string
  sessionId: string
}

/** Join Ticket 兑换的成功或拒绝结果。 */
export type JoinRedeemResult = JoinRedeemSuccess | JoinRejectedResult

/** 会话恢复失败时返回的显式结果。 */
export type SessionFailedResult = {
  kind: 'session.failed'
  reason: string
}

/** 会话恢复成功后由控制面确认的身份载荷。 */
export type SessionResumeSuccess = {
  kind: 'session.ack'
  sessionId: string
  serverTime: string
}

/** 会话恢复的成功或失败结果。 */
export type SessionResumeResult = SessionResumeSuccess | SessionFailedResult

/** 节点运行时注册 WireGuard 公钥的请求载荷。 */
export type RuntimeKeyRegistrationInput = {
  keyId: string
  publicKey: string
  createdAt: string
  /** 节点的公网 WireGuard 端点（STUN 发现），用于直接 P2P 连接。 */
  endpoint?: string
}

/** 节点运行时公钥注册的成功或失败结果。 */
export type RuntimeKeyRegistrationResult =
  | {
      kind: 'runtime.key.registered'
      nodeId: string
      keyId: string
      fingerprint: string
      mapVersion: number
      correlationId: string
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

/** 获取签名网络图的成功或失败结果。 */
export type RuntimeNetworkMapResult =
  | {
      kind: 'runtime.network_map.fetched'
      map: NetworkMapFromSchema
      sidecar: NodeAgentRuntimeDesiredSidecar
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

/** 心跳发送和超时的调度时间。 */
export type HeartbeatSchedule = {
  nextHeartbeatAt: number
  timeoutAt: number
}

/** 尚未开始 Join 的初始会话状态。 */
export type IdleSessionState = {
  kind: 'idle'
}

/** 正在通过 Join Ticket 建立会话的状态。 */
export type JoiningSessionState = {
  kind: 'joining'
  joinUrl: string
  ticket: string
}

/** Join 已接受但尚未确认恢复的会话状态。 */
export type JoinedSessionState = SessionIdentity & {
  kind: 'joined'
}

/** 已连接且正在维护心跳租约的会话状态。 */
export type ConnectedSessionState = SessionIdentity & {
  kind: 'connected'
  serverTime: string
  heartbeat: HeartbeatSchedule
  reconnectAttempt: number
}

/** 传输已关闭且尚未安排重连的会话状态。 */
export type DisconnectedSessionState = SessionIdentity & {
  kind: 'disconnected'
  reason: 'transport_closed' | 'heartbeat_timeout'
  reconnectAttempt: number
}

/** 已安排退避重连的会话状态。 */
export type ReconnectingSessionState = SessionIdentity & {
  kind: 'reconnecting'
  reason: 'transport_closed' | 'heartbeat_timeout'
  attempt: number
  retryAt: number
}

/** 节点代理在内存中可出现的完整会话状态联合。 */
export type SessionState =
  | IdleSessionState
  | JoiningSessionState
  | JoinedSessionState
  | ConnectedSessionState
  | DisconnectedSessionState
  | ReconnectingSessionState

/** 驱动纯会话状态机的输入事件联合。 */
export type SessionStateEvent =
  | {
      type: 'join.started'
      joinUrl: string
      ticket: string
    }
  | {
      type: 'join.redeemed'
      result: JoinRedeemSuccess
    }
  | {
      type: 'session.acknowledged'
      result: SessionResumeSuccess
      intervalMs: number
      timeoutMs: number
      nowMs: number
    }
  | {
      type: 'connection.closed'
      reason?: 'transport_closed'
    }
  | {
      type: 'reconnect.requested'
      atMs: number
      maxBackoffMs: number
      random?: () => number
    }
  | {
      type: 'heartbeat.acknowledged'
      atMs: number
      intervalMs: number
      timeoutMs: number
    }
  | {
      type: 'heartbeat.timed_out'
      atMs: number
      maxBackoffMs: number
      random?: () => number
    }

type SessionIdentity = {
  nodeId: string
  nodeToken: string
  controlUrl: string
  sessionId: string
}
