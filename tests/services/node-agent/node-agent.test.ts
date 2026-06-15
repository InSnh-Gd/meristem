import { describe, expect, it } from 'bun:test'
import type { MNetSessionServerMessage } from '../../../packages/contracts/src/index.ts'
import {
  decodeMessage,
  heartbeatIntervalMs,
  parseServerMessage,
  requiredOneOf
} from '../../../services/node-agent/src/node-agent-runtime.ts'

describe('node-agent runtime pure functions', () => {
  it('returns the first present environment value', () => {
    expect(requiredOneOf(['FIRST', 'SECOND'], { SECOND: 'fallback' })).toBe('fallback')
    expect(requiredOneOf(['FIRST', 'SECOND'], { FIRST: 'primary', SECOND: 'fallback' })).toBe(
      'primary'
    )
    expect(requiredOneOf(['FIRST', 'SECOND'], {})).toBeUndefined()
  })

  it('normalizes heartbeat intervals to a positive finite number', () => {
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '2500' })).toBe(2500)
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '0' })).toBe(5000)
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '-1' })).toBe(5000)
    expect(heartbeatIntervalMs({ MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: 'not-a-number' })).toBe(5000)
  })

  it('decodes string, array buffer, and blob websocket payloads', async () => {
    expect(decodeMessage('plain')).toBe('plain')

    const encoded = new TextEncoder().encode('buffered').buffer
    expect(decodeMessage(encoded)).toBe('buffered')

    await expect(decodeMessage(new Blob(['blobbed']))).resolves.toBe('blobbed')
  })

  it('parses server messages with string type fields', () => {
    const message: MNetSessionServerMessage = {
      type: 'task.execute',
      nodeId: 'node-1',
      taskId: 'task-1',
      taskType: 'noop',
      correlationId: 'correlation-1'
    }

    expect(parseServerMessage(JSON.stringify(message))).toEqual(message)
  })

  it('rejects invalid or malformed server messages', () => {
    expect(parseServerMessage('{')).toBeNull()
    expect(parseServerMessage(JSON.stringify(null))).toBeNull()
    expect(parseServerMessage(JSON.stringify({}))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 1 }))).toBeNull()
  })
})
