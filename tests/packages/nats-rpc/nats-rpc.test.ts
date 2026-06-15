import { describe, expect, it } from 'bun:test'
import { subjects, toNatsWebSocketUrl } from '../../../packages/nats-rpc/src/index.ts'

describe('packages/nats-rpc exports', () => {
  it('subjects contains expected keys', () => {
    expect(subjects).toContainKeys([
      'policyAuthorize',
      'timelineWrite',
      'fullWrite',
      'auditWrite',
      'eventPublish',
      'networkCreate',
      'networkList',
      'networkJoin'
    ])
  })

  it('toNatsWebSocketUrl converts nats URLs to ws URLs', () => {
    expect(toNatsWebSocketUrl('nats://localhost:4222')).toBe('ws://localhost:4223')
  })

  it('toNatsWebSocketUrl converts tls URLs to wss URLs', () => {
    expect(toNatsWebSocketUrl('tls://localhost:4222')).toBe('wss://localhost:4223')
  })

  it('toNatsWebSocketUrl passes through WebSocket URLs unchanged', () => {
    expect(toNatsWebSocketUrl('ws://localhost:4223')).toBe('ws://localhost:4223')
    expect(toNatsWebSocketUrl('wss://localhost:4223')).toBe('wss://localhost:4223')
  })

  it('toNatsWebSocketUrl handles custom ports correctly', () => {
    expect(toNatsWebSocketUrl('nats://localhost:4333')).toBe('ws://localhost:4333')
    expect(toNatsWebSocketUrl('tls://localhost:4444')).toBe('wss://localhost:4444')
  })
})
