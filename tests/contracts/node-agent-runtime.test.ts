import { describe, expect, it } from 'bun:test'
import {
  decodeMessage,
  heartbeatIntervalMs,
  parseServerMessage,
  requiredOneOf
} from '../../services/node-agent/src/node-agent-runtime.ts'

describe('node-agent runtime helpers', () => {
  it('returns the first configured environment value', () => {
    expect(
      requiredOneOf(['MERISTEM_JOIN_TICKET', 'MERISTEM_NODE_TOKEN'], {
        MERISTEM_JOIN_TICKET: '',
        MERISTEM_NODE_TOKEN: 'runtime-token'
      })
    ).toBe('runtime-token')
  })

  it('falls back to the default heartbeat interval when the configured value is invalid', () => {
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '0' })).toBe(5000)
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '-1' })).toBe(5000)
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: 'abc' })).toBe(5000)
  })

  it('accepts a positive heartbeat interval override', () => {
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '2500' })).toBe(2500)
  })

  it('passes string websocket payloads through unchanged', async () => {
    await expect(Promise.resolve(decodeMessage('plain-text'))).resolves.toBe('plain-text')
  })

  it('decodes binary websocket payloads into text', async () => {
    const payload = new TextEncoder().encode('binary-text').buffer
    await expect(Promise.resolve(decodeMessage(payload))).resolves.toBe('binary-text')
  })

  it('decodes blob websocket payloads into text', async () => {
    await expect(Promise.resolve(decodeMessage(new Blob(['blob-text'])))).resolves.toBe('blob-text')
  })

  it('parses supported session server messages by their versioned type envelope', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'join.accepted',
          sessionId: 'session-1',
          issuedAt: '2026-06-14T12:00:00.000Z',
          runtimeToken: 'runtime-token',
          node: {
            id: 'node-1',
            name: 'remote-leaf',
            kind: 'leaf',
            status: 'joining',
            capabilities: ['task.execute'],
            mode: 'agent',
            reachability: 'unknown',
            createdAt: '2026-06-14T12:00:00.000Z'
          }
        })
      )
    ).toEqual({
      type: 'join.accepted',
      sessionId: 'session-1',
      issuedAt: '2026-06-14T12:00:00.000Z',
      runtimeToken: 'runtime-token',
      node: {
        id: 'node-1',
        name: 'remote-leaf',
        kind: 'leaf',
        status: 'joining',
        capabilities: ['task.execute'],
        mode: 'agent',
        reachability: 'unknown',
        createdAt: '2026-06-14T12:00:00.000Z'
      }
    })
  })

  it('rejects malformed session server payloads before dispatch', () => {
    expect(parseServerMessage('not-json')).toBeNull()
    expect(parseServerMessage(JSON.stringify('plain-text'))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ sessionId: 'session-1' }))).toBeNull()
  })
})
