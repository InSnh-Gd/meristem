import type { JoinAcceptedMessage, SessionErrorMessage } from '../../../packages/contracts/src/index.ts'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import {
  NetworkMapSchema,
  type NetworkMapFromSchema
} from '../../../packages/contracts/src/schemas/mnet-profile.ts'

export type SessionAckMessage = {
  type: 'session.ack'
  sessionId: string
  serverTime: string
}

export type JoinRejectedResult = {
  kind: 'join.rejected'
  reason: string
}

export type JoinRedeemSuccess = {
  kind: 'join.accepted'
  nodeToken: string
  controlUrl: string
  nodeId: string
  sessionId: string
}

export type JoinRedeemResult = JoinRedeemSuccess | JoinRejectedResult

export type SessionFailedResult = {
  kind: 'session.failed'
  reason: string
}

export type SessionResumeSuccess = {
  kind: 'session.ack'
  sessionId: string
  serverTime: string
}

export type SessionResumeResult = SessionResumeSuccess | SessionFailedResult

export type RuntimeKeyRegistrationInput = {
  keyId: string
  publicKey: string
  createdAt: string
}

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

export type RuntimeNetworkMapResult =
  | {
      kind: 'runtime.network_map.fetched'
      map: NetworkMapFromSchema
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

export type HeartbeatSchedule = {
  nextHeartbeatAt: number
  timeoutAt: number
}

export type IdleSessionState = {
  kind: 'idle'
}

export type JoiningSessionState = {
  kind: 'joining'
  joinUrl: string
  ticket: string
}

type SessionIdentity = {
  nodeId: string
  nodeToken: string
  controlUrl: string
  sessionId: string
}

export type JoinedSessionState = SessionIdentity & {
  kind: 'joined'
}

export type ConnectedSessionState = SessionIdentity & {
  kind: 'connected'
  serverTime: string
  heartbeat: HeartbeatSchedule
  reconnectAttempt: number
}

export type DisconnectedSessionState = SessionIdentity & {
  kind: 'disconnected'
  reason: 'transport_closed' | 'heartbeat_timeout'
  reconnectAttempt: number
}

export type ReconnectingSessionState = SessionIdentity & {
  kind: 'reconnecting'
  reason: 'transport_closed' | 'heartbeat_timeout'
  attempt: number
  retryAt: number
}

export type SessionState =
  | IdleSessionState
  | JoiningSessionState
  | JoinedSessionState
  | ConnectedSessionState
  | DisconnectedSessionState
  | ReconnectingSessionState

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

type JoinRedeemInput = JoinAcceptedMessage | SessionErrorMessage
type SessionResumeInput = SessionAckMessage | SessionErrorMessage

type RuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const NodeRuntimeKeyRegistrationResponseSchema = Schema.Struct({
  nodeId: Schema.NonEmptyString,
  keyId: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  mapVersion: Schema.Number.pipe(Schema.greaterThanOrEqualTo(1)),
  correlationId: Schema.NonEmptyString
})

const NodeRuntimeNetworkMapResponseSchema = Schema.Struct({
  map: NetworkMapSchema
})

const decodeNodeRuntimeKeyRegistrationResponse = Schema.decodeUnknownEither(
  NodeRuntimeKeyRegistrationResponseSchema
)
const decodeNodeRuntimeNetworkMapResponse = Schema.decodeUnknownEither(
  NodeRuntimeNetworkMapResponseSchema
)

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

export function deriveControlUrl(joinUrl: string): string | null {
  try {
    const parsed = new URL(joinUrl)
    const controlProtocol =
      parsed.protocol === 'wss:' || parsed.protocol === 'https:' ? 'https:' : 'http:'
    parsed.protocol = controlProtocol
    parsed.port = '3104'
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function createNodeRuntimeUrl(controlUrl: string, nodeId: string, suffix: 'key' | 'network-map'): URL {
  const url = new URL(
    `/api/v0/node-runtime/nodes/${encodeURIComponent(nodeId)}/${suffix}`,
    controlUrl.endsWith('/') ? controlUrl : `${controlUrl}/`
  )
  return url
}

async function parseRuntimeFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    const message = payload.error?.message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message
    }
  } catch {
    // ignored: fall through to generic status reason
  }

  return `runtime request failed with status ${response.status}`
}

export async function registerNodeRuntimeKey(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  input: RuntimeKeyRegistrationInput,
  fetchImpl: RuntimeFetch = fetch
): Promise<RuntimeKeyRegistrationResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'key'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nodeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(input)
    })

    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }

    const payload = decodeNodeRuntimeKeyRegistrationResponse(await response.json())
    if (Either.isLeft(payload)) {
      return { kind: 'runtime.request_failed', reason: 'runtime key registration response is invalid' }
    }

    return { kind: 'runtime.key.registered', ...payload.right }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'runtime key registration failed'
    }
  }
}

export async function fetchLatestNodeRuntimeNetworkMap(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  fetchImpl: RuntimeFetch = fetch
): Promise<RuntimeNetworkMapResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'network-map'), {
      headers: {
        authorization: `Bearer ${nodeToken}`
      }
    })

    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }

    const payload = decodeNodeRuntimeNetworkMapResponse(await response.json())
    if (Either.isLeft(payload)) {
      return { kind: 'runtime.request_failed', reason: 'runtime network-map response is invalid' }
    }

    return { kind: 'runtime.network_map.fetched', map: payload.right.map }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'runtime network-map fetch failed'
    }
  }
}

function normalizeReason(message: SessionErrorMessage): string {
  return isNonEmptyString(message.message) ? message.message : message.code
}

function hasSessionIdentity(
  state: SessionState
): state is Exclude<SessionState, IdleSessionState | JoiningSessionState> {
  return (
    state.kind === 'joined' ||
    state.kind === 'connected' ||
    state.kind === 'disconnected' ||
    state.kind === 'reconnecting'
  )
}

/**
 * 创建纯内存会话状态机的初始状态，供运行时在首连前保存最小状态。
 */
export function createInitialSessionState(): IdleSessionState {
  return { kind: 'idle' }
}

/**
 * 解析 Join Ticket 兑换结果，并从 join ingress URL 推导控制面 URL，整个过程不执行任何 I/O。
 */
export function redeemJoinTicket(
  joinUrl: string,
  ticket: string,
  response: JoinRedeemInput
): JoinRedeemResult {
  if (!isNonEmptyString(ticket)) {
    return { kind: 'join.rejected', reason: 'join ticket is required' }
  }

  const controlUrl = deriveControlUrl(joinUrl)
  if (!controlUrl) {
    return { kind: 'join.rejected', reason: 'join url is invalid' }
  }

  if (response.type === 'error') {
    return {
      kind: 'join.rejected',
      reason: normalizeReason(response)
    }
  }

  return {
    kind: 'join.accepted',
    nodeToken: response.runtimeToken,
    controlUrl,
    nodeId: response.node.id,
    sessionId: response.sessionId
  }
}

/**
 * 解析 session resume 的确认结果，调用方负责把真实网络返回值作为参数传入，从而保持纯函数边界。
 */
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

  if (!isNonEmptyString(nodeToken)) {
    return { kind: 'session.failed', reason: 'node token is required' }
  }

  if (response.type === 'error') {
    return {
      kind: 'session.failed',
      reason: normalizeReason(response)
    }
  }

  return {
    kind: 'session.ack',
    sessionId: response.sessionId,
    serverTime: response.serverTime
  }
}

/**
 * 计算指数退避毫秒数，并附加最多 20% 的正向抖动，避免多个节点在同一时刻同时重连。
 */
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

/**
 * 根据当前时刻生成下一次心跳发送时间与确认超时时刻，供运行时调度计时器而不是在模块内直接启动计时器。
 */
export function createHeartbeatSchedule(
  intervalMs: number,
  timeoutMs: number,
  nowMs: number = Date.now()
): HeartbeatSchedule {
  const safeIntervalMs = Math.max(1, Math.trunc(intervalMs))
  const safeTimeoutMs = Math.max(1, Math.trunc(timeoutMs))
  const nextHeartbeatAt = nowMs + safeIntervalMs
  return {
    nextHeartbeatAt,
    timeoutAt: nextHeartbeatAt + safeTimeoutMs
  }
}

/**
 * 以纯数据转换驱动会话生命周期：join、ack、断线、重连与心跳超时都在这里归一化，避免运行时散落多套状态分支。
 */
export function transitionSessionState(
  state: SessionState,
  event: SessionStateEvent
): SessionState {
  if (event.type === 'join.started') {
    return {
      kind: 'joining',
      joinUrl: event.joinUrl,
      ticket: event.ticket
    }
  }

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
    if (!hasSessionIdentity(state)) {
      return state
    }
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

  if (event.type === 'connection.closed') {
    if (state.kind !== 'connected') {
      return state
    }
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
    if (state.kind !== 'disconnected') {
      return state
    }
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
    if (state.kind !== 'connected') {
      return state
    }
    return {
      ...state,
      heartbeat: createHeartbeatSchedule(event.intervalMs, event.timeoutMs, event.atMs)
    }
  }

  if (event.type === 'heartbeat.timed_out') {
    if (state.kind !== 'connected') {
      return state
    }
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
