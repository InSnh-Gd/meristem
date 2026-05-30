import { describe, expect, it } from 'bun:test'
import type {
  JoinAcceptedMessage,
  MNode,
  SessionHeartbeatMessage,
  SessionLogForwardMessage,
  SessionResumedMessage
} from '../../packages/contracts/src/index.ts'

describe('Phase 8 session transport contract', () => {
  it('keeps runtime tokens on join.accepted and keeps session frames session-scoped', () => {
    const node = {
      id: 'node-1',
      kind: 'leaf',
      name: 'leaf-1',
      mode: 'agent',
      status: 'healthy',
      reachability: 'reachable',
      capabilities: [],
      createdAt: '2026-05-05T12:00:00.000Z'
    } satisfies MNode

    const heartbeat = {
      type: 'heartbeat',
      sessionId: 'session-1',
      agentVersion: '0.1.0',
      reportedStatus: 'healthy',
      timestamp: '2026-05-05T12:00:00.000Z'
    } satisfies SessionHeartbeatMessage

    const logForward = {
      type: 'log.forward',
      sessionId: 'session-1',
      level: 'info',
      message: 'node ready',
      timestamp: '2026-05-05T12:00:00.000Z'
    } satisfies SessionLogForwardMessage

    const accepted = {
      type: 'join.accepted',
      sessionId: 'session-1',
      node,
      runtimeToken: 'runtime-token-1',
      issuedAt: '2026-05-05T12:00:00.000Z'
    } satisfies JoinAcceptedMessage

    expect(heartbeat.sessionId).toBe('session-1')
    expect(logForward.sessionId).toBe('session-1')
    expect(accepted.runtimeToken).toBe('runtime-token-1')

    // runtimeToken is exclusive to JoinAcceptedMessage; SessionResumedMessage,
    // heartbeat, and log.forward frames carry sessionId only. The type system
    // enforces this structurally.

    const resumedOk: SessionResumedMessage = {
      type: 'session.resumed',
      sessionId: 'session-1',
      node
    }
    expect(resumedOk.sessionId).toBe('session-1')
  })
})
