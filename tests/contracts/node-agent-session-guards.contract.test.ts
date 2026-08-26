import { describe, expect, it } from 'bun:test'
import type { JoinAcceptedMessage } from '../../packages/contracts/src/index.ts'
import {
  fetchLatestNodeRuntimeNetworkMap,
  registerNodeRuntimeKey
} from '../../services/node-agent/src/node-agent-session-runtime-control.ts'
import {
  redeemJoinTicket,
  resumeSession,
  transitionSessionState
} from '../../services/node-agent/src/node-agent-session-state-machine.ts'

const accepted: JoinAcceptedMessage = {
  type: 'join.accepted',
  sessionId: 'session-guard',
  runtimeToken: 'runtime-guard',
  issuedAt: '2026-08-01T00:00:00.000Z',
  node: {
    id: 'node-guard',
    name: 'guarded-leaf',
    kind: 'leaf',
    mode: 'agent',
    status: 'joining',
    reachability: 'unknown',
    capabilities: [],
    createdAt: '2026-08-01T00:00:00.000Z'
  }
}

describe('node-agent session fail-closed guards', () => {
  it('rejects blank tickets, malformed join URLs, and join ingress errors before identity is created', () => {
    expect(redeemJoinTicket('wss://mnet.test/join/v0/session', ' ', accepted)).toEqual({
      kind: 'join.rejected',
      reason: 'join ticket is required'
    })
    expect(redeemJoinTicket('not a url', 'ticket', accepted)).toEqual({
      kind: 'join.rejected',
      reason: 'join url is invalid'
    })
    expect(
      redeemJoinTicket('wss://mnet.test/join/v0/session', 'ticket', {
        type: 'error',
        code: 'node.join_ticket_invalid',
        message: ''
      })
    ).toEqual({ kind: 'join.rejected', reason: 'node.join_ticket_invalid' })
  })

  it('rejects malformed resume inputs and refuses impossible state transitions', () => {
    const acknowledgement = {
      type: 'session.ack' as const,
      sessionId: 'session-resume',
      serverTime: '2026-08-01T00:01:00.000Z'
    }
    const resumed = {
      kind: 'session.ack' as const,
      sessionId: acknowledgement.sessionId,
      serverTime: acknowledgement.serverTime
    }
    expect(resumeSession('not a url', 'runtime-token', acknowledgement)).toEqual({
      kind: 'session.failed',
      reason: 'control url is invalid'
    })
    expect(resumeSession('https://mnet.test', ' ', acknowledgement)).toEqual({
      kind: 'session.failed',
      reason: 'node token is required'
    })
    expect(
      resumeSession('https://mnet.test', 'runtime-token', {
        type: 'error',
        code: 'nodeagent.invalid_token',
        message: 'credential revoked'
      })
    ).toEqual({ kind: 'session.failed', reason: 'credential revoked' })

    const idle = { kind: 'idle' as const }
    expect(
      transitionSessionState(idle, {
        type: 'session.acknowledged',
        result: resumed,
        intervalMs: 1_000,
        timeoutMs: 2_000,
        nowMs: 0
      })
    ).toEqual(idle)
    expect(transitionSessionState(idle, { type: 'connection.closed' })).toEqual(idle)
    expect(
      transitionSessionState(idle, {
        type: 'heartbeat.timed_out',
        atMs: 1_000,
        maxBackoffMs: 30_000
      })
    ).toEqual(idle)
  })

  it('returns typed failures for rejected, malformed, and unavailable runtime control responses', async () => {
    const registrationInput = {
      keyId: 'wg-guard',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      createdAt: '2026-08-01T00:00:00.000Z'
    }
    await expect(
      registerNodeRuntimeKey(
        'http://127.0.0.1:3104',
        'node-guard',
        'runtime-token',
        registrationInput,
        async () => new Response('forbidden', { status: 403 })
      )
    ).resolves.toEqual({
      kind: 'runtime.request_failed',
      reason: 'runtime request failed with status 403'
    })
    await expect(
      registerNodeRuntimeKey(
        'http://127.0.0.1:3104',
        'node-guard',
        'runtime-token',
        registrationInput,
        async () => new Response(JSON.stringify({ malformed: true }), { status: 200 })
      )
    ).resolves.toEqual({
      kind: 'runtime.request_failed',
      reason: 'runtime key registration response is invalid'
    })
    await expect(
      fetchLatestNodeRuntimeNetworkMap(
        'http://127.0.0.1:3104',
        'node-guard',
        'runtime-token',
        async () => {
          throw new Error('control unavailable')
        }
      )
    ).resolves.toEqual({ kind: 'runtime.request_failed', reason: 'control unavailable' })
  })
})
