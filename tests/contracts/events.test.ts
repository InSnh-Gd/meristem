import { describe, expect, it } from 'bun:test'
import { createEventEnvelope, validateEventEnvelope } from '../../packages/events/src/index.ts'

describe('MEventEnvelope', () => {
  it('creates a versioned event envelope with required fields', () => {
    const event = createEventEnvelope({
      type: 'node.registration.accepted',
      source: 'meristem-core',
      payload: { nodeId: 'node-1' },
      correlationId: 'corr-1'
    })

    expect(event.id.length).toBeGreaterThan(10)
    expect(event.version).toBe('v0')
    expect(event.correlationId).toBe('corr-1')
    expect(validateEventEnvelope(event).ok).toBe(true)
  })

  it('rejects envelopes with missing required fields', () => {
    const result = validateEventEnvelope({
      id: 'event-1',
      version: 'v0',
      source: 'meristem-core',
      timestamp: new Date().toISOString(),
      payload: {}
    })

    expect(result.ok).toBe(false)
  })
})
