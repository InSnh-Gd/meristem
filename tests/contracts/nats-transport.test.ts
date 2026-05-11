import { describe, expect, it } from 'bun:test'
import { toNatsWebSocketUrl } from '../../packages/nats-rpc/src/index.ts'

describe('nats websocket transport config', () => {
  it('maps local tcp nats urls to the websocket port used by Bun clients', () => {
    expect(toNatsWebSocketUrl('nats://localhost:4222')).toBe('ws://localhost:4223')
  })

  it('preserves explicit websocket urls', () => {
    expect(toNatsWebSocketUrl('ws://45.204.206.45:4223')).toBe('ws://45.204.206.45:4223')
  })
})
