import type {
  JoinAcceptedMessage,
  SessionErrorMessage
} from '../../../packages/contracts/src/index.ts'
import type {
  ConnectedSessionState,
  HeartbeatSchedule,
  IdleSessionState,
  JoinRedeemResult,
  SessionAckMessage,
  SessionResumeResult,
  SessionState,
  SessionStateEvent
} from './node-agent-session-contracts.ts'
import { deriveControlUrl } from './node-agent-session-runtime-control.ts'

type JoinRedeemInput = JoinAcceptedMessage | SessionErrorMessage
type SessionResumeInput = SessionAckMessage | SessionErrorMessage

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function normalizeReason(
  message: Extract<JoinRedeemInput | SessionResumeInput, { type: 'error' }>
): string {
  return isNonEmptyString(message.message) ? message.message : message.code
}

function hasSessionIdentity(
  state: SessionState
): state is Exclude<SessionState, { kind: 'idle' } | { kind: 'joining' }> {
  return (
    state.kind === 'joined' ||
    state.kind === 'connected' ||
    state.kind === 'disconnected' ||
    state.kind === 'reconnecting'
  )
}

/** 创建纯内存会话状态机的初始状态，供运行时在首连前保存最小状态。 */
export function createInitialSessionState(): IdleSessionState {
  return { kind: 'idle' }
}

/** 解析 Join Ticket 兑换结果，并在无效 ticket 或 URL 时拒绝进入会话。 */
export function redeemJoinTicket(
  joinUrl: string,
  ticket: string,
  response: JoinRedeemInput
): JoinRedeemResult {
  if (!isNonEmptyString(ticket)) return { kind: 'join.rejected', reason: 'join ticket is required' }
  const controlUrl = deriveControlUrl(joinUrl)
  if (!controlUrl) return { kind: 'join.rejected', reason: 'join url is invalid' }
  if (response.type === 'error') return { kind: 'join.rejected', reason: normalizeReason(response) }
  return {
    kind: 'join.accepted',
    nodeToken: response.runtimeToken,
    controlUrl,
    nodeId: response.node.id,
    sessionId: response.sessionId
  }
}

/** 解析 session resume 确认结果，拒绝无效控制地址、令牌与控制面错误。 */
export function resumeSession(
  controlUrl: string,
  nodeToken: string,
  response: SessionResumeInput
): SessionResumeResult {
  try {
    new URL(controlUrl)
  } catch {
    return { kind: 'session.failed', reason: 'control url is invalid' }
  }
  if (!isNonEmptyString(nodeToken))
    return { kind: 'session.failed', reason: 'node token is required' }
  if (response.type === 'error')
    return { kind: 'session.failed', reason: normalizeReason(response) }
  return { kind: 'session.ack', sessionId: response.sessionId, serverTime: response.serverTime }
}

/** 计算指数退避毫秒数，并附加最多 20% 的正向抖动，避免节点同时重连。 */
export function calculateBackoff(
  attempt: number,
  maxBackoffMs: number,
  random: () => number = Math.random
): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt))
  const cappedBase = Math.min(1000 * 2 ** (normalizedAttempt - 1), maxBackoffMs)
  const clampedRandom = Math.min(Math.max(random(), 0), 1)
  const jitter = Math.floor(cappedBase * 0.2 * clampedRandom)
  return Math.min(cappedBase + jitter, maxBackoffMs)
}

/** 根据当前时刻生成下一次心跳发送时间与确认超时时刻。 */
export function createHeartbeatSchedule(
  intervalMs: number,
  timeoutMs: number,
  nowMs: number = Date.now()
): HeartbeatSchedule {
  const safeIntervalMs = Math.max(1, Math.trunc(intervalMs))
  const safeTimeoutMs = Math.max(1, Math.trunc(timeoutMs))
  const nextHeartbeatAt = nowMs + safeIntervalMs
  return { nextHeartbeatAt, timeoutAt: nextHeartbeatAt + safeTimeoutMs }
}

/**
 * 以纯数据转换驱动会话生命周期；不合法的状态转换一律保持原状态，避免未认证或陈旧事件推进会话。
 */
export function transitionSessionState(
  state: SessionState,
  event: SessionStateEvent
): SessionState {
  if (event.type === 'join.started')
    return { kind: 'joining', joinUrl: event.joinUrl, ticket: event.ticket }
  if (event.type === 'join.redeemed') {
    return {
      kind: 'joined',
      nodeId: event.result.nodeId,
      nodeToken: event.result.nodeToken,
      controlUrl: event.result.controlUrl,
      sessionId: event.result.sessionId
    }
  }
  if (event.type === 'session.acknowledged') {
    if (!hasSessionIdentity(state)) return state
    return connectedState(state, event)
  }
  if (event.type === 'connection.closed') {
    if (state.kind !== 'connected') return state
    return {
      kind: 'disconnected',
      nodeId: state.nodeId,
      nodeToken: state.nodeToken,
      controlUrl: state.controlUrl,
      sessionId: state.sessionId,
      reason: event.reason ?? 'transport_closed',
      reconnectAttempt: state.reconnectAttempt
    }
  }
  if (event.type === 'reconnect.requested') {
    if (state.kind !== 'disconnected') return state
    const attempt = state.reconnectAttempt + 1
    return {
      kind: 'reconnecting',
      nodeId: state.nodeId,
      nodeToken: state.nodeToken,
      controlUrl: state.controlUrl,
      sessionId: state.sessionId,
      reason: state.reason,
      attempt,
      retryAt: event.atMs + calculateBackoff(attempt, event.maxBackoffMs, event.random)
    }
  }
  if (event.type === 'heartbeat.acknowledged') {
    if (state.kind !== 'connected') return state
    return {
      ...state,
      heartbeat: createHeartbeatSchedule(event.intervalMs, event.timeoutMs, event.atMs)
    }
  }
  if (event.type === 'heartbeat.timed_out') {
    if (state.kind !== 'connected') return state
    const attempt = state.reconnectAttempt + 1
    return {
      kind: 'reconnecting',
      nodeId: state.nodeId,
      nodeToken: state.nodeToken,
      controlUrl: state.controlUrl,
      sessionId: state.sessionId,
      reason: 'heartbeat_timeout',
      attempt,
      retryAt: event.atMs + calculateBackoff(attempt, event.maxBackoffMs, event.random)
    }
  }
  return state
}

function connectedState(
  state: Exclude<SessionState, { kind: 'idle' } | { kind: 'joining' }>,
  event: Extract<SessionStateEvent, { type: 'session.acknowledged' }>
): ConnectedSessionState {
  return {
    kind: 'connected',
    nodeId: state.nodeId,
    nodeToken: state.nodeToken,
    controlUrl: state.controlUrl,
    sessionId: event.result.sessionId,
    serverTime: event.result.serverTime,
    heartbeat: createHeartbeatSchedule(event.intervalMs, event.timeoutMs, event.nowMs),
    reconnectAttempt: 0
  }
}
