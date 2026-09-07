import { describe, expect, it } from 'bun:test'
import {
  calculateBackoff,
  createHeartbeatSchedule,
  createInitialSessionState,
  redeemJoinTicket,
  resumeSession,
  type SessionState,
  transitionSessionState
} from '../../../services/node-agent/src/node-agent-session-state.ts'

/** 构造一个已连接状态，作为断线/心跳事件的迁移起点。 */
function createConnectedState(): SessionState {
  let state: SessionState = createInitialSessionState()
  state = transitionSessionState(state, {
    type: 'join.started',
    joinUrl: 'wss://ingress.example/join',
    ticket: 'ticket-1'
  })
  state = transitionSessionState(state, {
    type: 'join.redeemed',
    result: {
      kind: 'join.accepted',
      nodeToken: 'token-1',
      controlUrl: 'https://control.example',
      nodeId: 'node-1',
      sessionId: 'session-1'
    }
  })
  return transitionSessionState(state, {
    type: 'session.acknowledged',
    result: { kind: 'session.ack', sessionId: 'session-2', serverTime: '2026-01-01T00:00:00Z' },
    intervalMs: 5000,
    timeoutMs: 1500,
    nowMs: 1_000
  })
}

describe('node-agent session state pure FSM', () => {
  it('createInitialSessionState starts idle', () => {
    expect(createInitialSessionState()).toEqual({ kind: 'idle' })
  })

  it('join flow: idle → joining → joined → connected', () => {
    let state: SessionState = createInitialSessionState()
    state = transitionSessionState(state, {
      type: 'join.started',
      joinUrl: 'wss://ingress.example/join',
      ticket: 'ticket-1'
    })
    expect(state).toEqual({
      kind: 'joining',
      joinUrl: 'wss://ingress.example/join',
      ticket: 'ticket-1'
    })

    state = transitionSessionState(state, {
      type: 'join.redeemed',
      result: {
        kind: 'join.accepted',
        nodeToken: 'token-1',
        controlUrl: 'https://control.example',
        nodeId: 'node-1',
        sessionId: 'session-1'
      }
    })
    expect(state).toEqual({
      kind: 'joined',
      nodeId: 'node-1',
      nodeToken: 'token-1',
      controlUrl: 'https://control.example',
      sessionId: 'session-1'
    })

    state = transitionSessionState(state, {
      type: 'session.acknowledged',
      result: { kind: 'session.ack', sessionId: 'session-2', serverTime: '2026-01-01T00:00:00Z' },
      intervalMs: 5000,
      timeoutMs: 1500,
      nowMs: 10_000
    })
    expect(state).toMatchObject({
      kind: 'connected',
      sessionId: 'session-2',
      reconnectAttempt: 0,
      heartbeat: { nextHeartbeatAt: 15_000, timeoutAt: 16_500 }
    })
  })

  it('session.acknowledged is ignored before identity exists', () => {
    const state = createInitialSessionState()
    expect(
      transitionSessionState(state, {
        type: 'session.acknowledged',
        result: { kind: 'session.ack', sessionId: 's', serverTime: 't' },
        intervalMs: 1000,
        timeoutMs: 1000,
        nowMs: 0
      })
    ).toBe(state)
  })

  it('connection.closed → disconnected keeps reconnectAttempt', () => {
    const connected = createConnectedState()
    expect(connected.kind).toBe('connected')
    const closed = transitionSessionState(connected, { type: 'connection.closed' })
    expect(closed).toMatchObject({
      kind: 'disconnected',
      reason: 'transport_closed',
      reconnectAttempt: 0
    })
    // 非 connected 状态上的 connection.closed 不迁移
    expect(transitionSessionState(closed, { type: 'connection.closed' })).toBe(closed)
  })

  it('reconnect.requested escalates attempt and schedules backoff', () => {
    const connected = createConnectedState()
    let state = transitionSessionState(connected, { type: 'connection.closed' })
    state = transitionSessionState(state, {
      type: 'reconnect.requested',
      atMs: 5_000,
      maxBackoffMs: 8_000,
      random: () => 0
    })
    expect(state).toMatchObject({
      kind: 'reconnecting',
      attempt: 1,
      reason: 'transport_closed',
      retryAt: 6_000
    })
  })

  it('heartbeat.timed_out → reconnecting with heartbeat_timeout reason', () => {
    const connected = createConnectedState()
    const state = transitionSessionState(connected, {
      type: 'heartbeat.timed_out',
      atMs: 10_000,
      maxBackoffMs: 30_000,
      random: () => 1
    })
    expect(state).toMatchObject({ kind: 'reconnecting', reason: 'heartbeat_timeout', attempt: 1 })
  })

  it('heartbeat.acknowledged refreshes schedule only when connected', () => {
    const connected = createConnectedState()
    const acked = transitionSessionState(connected, {
      type: 'heartbeat.acknowledged',
      atMs: 20_000,
      intervalMs: 2_000,
      timeoutMs: 1_000
    })
    expect(acked).toMatchObject({
      kind: 'connected',
      heartbeat: { nextHeartbeatAt: 22_000, timeoutAt: 23_000 }
    })
    expect(
      transitionSessionState(createInitialSessionState(), {
        type: 'heartbeat.acknowledged',
        atMs: 0,
        intervalMs: 1_000,
        timeoutMs: 1_000
      })
    ).toEqual({ kind: 'idle' })
  })

  it('calculateBackoff: exponential base, cap, zero jitter, and min-attempt clamp', () => {
    expect(calculateBackoff(1, 60_000, () => 0)).toBe(1_000)
    expect(calculateBackoff(2, 60_000, () => 0)).toBe(2_000)
    expect(calculateBackoff(3, 60_000, () => 0)).toBe(4_000)
    // cap 生效
    expect(calculateBackoff(10, 8_000, () => 0)).toBe(8_000)
    // 最大抖动不超过 20%，且不超过 cap
    expect(calculateBackoff(1, 60_000, () => 1)).toBe(1_200)
    // attempt 被钳制到 >= 1
    expect(calculateBackoff(0, 60_000, () => 0)).toBe(1_000)
    expect(calculateBackoff(-5, 60_000, () => 0)).toBe(1_000)
  })

  it('createHeartbeatSchedule: clamps non-positive values and derives timeout', () => {
    expect(createHeartbeatSchedule(5_000, 1_500, 1_000)).toEqual({
      nextHeartbeatAt: 6_000,
      timeoutAt: 7_500
    })
    expect(createHeartbeatSchedule(0, -3, 100)).toEqual({
      nextHeartbeatAt: 101,
      timeoutAt: 102
    })
  })

  it('redeemJoinTicket rejects invalid ticket/url and error responses', () => {
    const accepted = {
      type: 'join.accepted' as const,
      sessionId: 'session-1',
      node: {
        id: 'node-1',
        kind: 'leaf' as const,
        name: 'node-1',
        mode: 'agent' as const,
        status: 'ready' as const,
        reachability: 'unknown' as const,
        capabilities: []
      },
      runtimeToken: 'token-1',
      issuedAt: '2026-01-01T00:00:00Z'
    }
    expect(redeemJoinTicket('wss://ingress.example/join', '  ', accepted)).toEqual({
      kind: 'join.rejected',
      reason: 'join ticket is required'
    })
    expect(redeemJoinTicket('not-a-url', 'ticket-1', accepted)).toEqual({
      kind: 'join.rejected',
      reason: 'join url is invalid'
    })
    expect(
      redeemJoinTicket('wss://ingress.example/join', 'ticket-1', {
        type: 'error',
        code: 'join.expired',
        message: ''
      })
    ).toEqual({ kind: 'join.rejected', reason: 'join.expired' })
    const result = redeemJoinTicket('wss://ingress.example/join', 'ticket-1', accepted)
    expect(result).toMatchObject({
      kind: 'join.accepted',
      nodeId: 'node-1',
      nodeToken: 'token-1',
      sessionId: 'session-1'
    })
    expect(result.kind === 'join.accepted' && result.controlUrl).toBe(
      'https://ingress.example:3104'
    )
  })

  it('resumeSession validates url/token and normalizes error reasons', () => {
    expect(
      resumeSession('bad-url', 'token', { type: 'session.ack', sessionId: 's', serverTime: 't' })
    ).toEqual({ kind: 'session.failed', reason: 'control url is invalid' })
    expect(
      resumeSession('https://control.example', ' ', {
        type: 'session.ack',
        sessionId: 's',
        serverTime: 't'
      })
    ).toEqual({ kind: 'session.failed', reason: 'node token is required' })
    expect(
      resumeSession('https://control.example', 'token', {
        type: 'error',
        code: 'session.unknown',
        message: 'gone'
      })
    ).toEqual({ kind: 'session.failed', reason: 'gone' })
    expect(
      resumeSession('https://control.example', 'token', {
        type: 'session.ack',
        sessionId: 'session-1',
        serverTime: '2026-01-01T00:00:00Z'
      })
    ).toEqual({ kind: 'session.ack', sessionId: 'session-1', serverTime: '2026-01-01T00:00:00Z' })
  })
})
