import { describe, expect, it } from 'bun:test'
import type {
  JoinAcceptedMessage,
  SessionErrorMessage
} from '../../packages/contracts/src/index.ts'
import {
  calculateBackoff,
  createHeartbeatSchedule,
  createInitialSessionState,
  redeemJoinTicket,
  resumeSession,
  type SessionAckMessage,
  type SessionState,
  transitionSessionState
} from '../../services/node-agent/src/node-agent-session.ts'

function createJoinAcceptedMessage(): JoinAcceptedMessage {
  return {
    type: 'join.accepted',
    sessionId: 'session-1',
    runtimeToken: 'node-token-1',
    issuedAt: '2026-06-18T12:00:00.000Z',
    node: {
      id: 'node-1',
      name: 'leaf-1',
      kind: 'leaf',
      mode: 'agent',
      status: 'joining',
      reachability: 'unknown',
      capabilities: ['task.execute'],
      createdAt: '2026-06-18T12:00:00.000Z'
    }
  }
}

function createConnectedState(): SessionState {
  const joinAccepted = createJoinAcceptedMessage()
  const redeemed = redeemJoinTicket(
    'wss://mnet.example:8443/join/v0/session',
    'join-ticket-1',
    joinAccepted
  )

  if (redeemed.kind !== 'join.accepted') {
    throw new Error('expected join.accepted result for test fixture')
  }

  const sessionAck: SessionAckMessage = {
    type: 'session.ack',
    sessionId: 'session-2',
    serverTime: '2026-06-18T12:01:00.000Z'
  }
  const resumed = resumeSession('https://mnet.example:3104', redeemed.nodeToken, sessionAck)

  if (resumed.kind !== 'session.ack') {
    throw new Error('expected session.ack result for test fixture')
  }

  return transitionSessionState(
    transitionSessionState(
      transitionSessionState(createInitialSessionState(), {
        type: 'join.started',
        joinUrl: 'wss://mnet.example:8443/join/v0/session',
        ticket: 'join-ticket-1'
      }),
      {
        type: 'join.redeemed',
        result: redeemed
      }
    ),
    {
      type: 'session.acknowledged',
      result: resumed,
      intervalMs: 30_000,
      timeoutMs: 90_000,
      nowMs: 1_000
    }
  )
}

describe('node-agent session lifecycle contract', () => {
  it('redeems a join ticket into a node token, control url, and node identity', () => {
    const accepted = createJoinAcceptedMessage()

    expect(
      redeemJoinTicket('wss://mnet.example:8443/join/v0/session', 'join-ticket-1', accepted)
    ).toEqual({
      kind: 'join.accepted',
      nodeToken: 'node-token-1',
      controlUrl: 'https://mnet.example:3104',
      nodeId: 'node-1',
      sessionId: 'session-1'
    })
  })

  it('resumes an existing node token and transitions the session into connected', () => {
    const connected = createConnectedState()

    expect(connected.kind).toBe('connected')
    if (connected.kind !== 'connected') {
      throw new Error('expected connected state')
    }
    expect(connected.sessionId).toBe('session-2')
    expect(connected.serverTime).toBe('2026-06-18T12:01:00.000Z')
  })

  it('uses exponential reconnect backoff with jitter and a 30 second cap', () => {
    expect(calculateBackoff(1, 30_000, () => 0)).toBe(1_000)
    expect(calculateBackoff(2, 30_000, () => 0)).toBe(2_000)
    expect(calculateBackoff(3, 30_000, () => 0)).toBe(4_000)
    expect(calculateBackoff(4, 30_000, () => 0)).toBe(8_000)
    expect(calculateBackoff(6, 30_000, () => 0)).toBe(30_000)

    const jittered = calculateBackoff(3, 30_000, () => 0.5)
    expect(jittered).toBeGreaterThan(4_000)
    expect(jittered).toBeLessThanOrEqual(4_800)
  })

  it('schedules the next heartbeat and refreshes it after a heartbeat ack', () => {
    expect(createHeartbeatSchedule(30_000, 90_000, 1_000)).toEqual({
      nextHeartbeatAt: 31_000,
      timeoutAt: 121_000
    })

    const connected = createConnectedState()
    const afterAck = transitionSessionState(connected, {
      type: 'heartbeat.acknowledged',
      atMs: 121_000,
      intervalMs: 30_000,
      timeoutMs: 90_000
    })

    expect(afterAck.kind).toBe('connected')
    if (afterAck.kind !== 'connected') {
      throw new Error('expected connected state after heartbeat ack')
    }
    expect(afterAck.heartbeat).toEqual({
      nextHeartbeatAt: 151_000,
      timeoutAt: 241_000
    })
  })

  it('triggers reconnect scheduling when heartbeat acknowledgements stop arriving', () => {
    const connected = createConnectedState()
    const reconnecting = transitionSessionState(connected, {
      type: 'heartbeat.timed_out',
      atMs: 121_000,
      maxBackoffMs: 30_000,
      random: () => 0
    })

    expect(reconnecting).toEqual({
      kind: 'reconnecting',
      nodeId: 'node-1',
      nodeToken: 'node-token-1',
      controlUrl: 'https://mnet.example:3104',
      sessionId: 'session-2',
      reason: 'heartbeat_timeout',
      attempt: 1,
      retryAt: 122_000
    })
  })

  it('returns a typed join rejection when the join ticket is invalid', () => {
    const rejectedMessage: SessionErrorMessage = {
      type: 'error',
      code: 'node.join_ticket_invalid',
      message: 'join ticket is invalid'
    }

    expect(
      redeemJoinTicket('wss://mnet.example:8443/join/v0/session', 'invalid-ticket', rejectedMessage)
    ).toEqual({
      kind: 'join.rejected',
      reason: 'join ticket is invalid'
    })
  })
})
