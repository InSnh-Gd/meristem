import { describe, expect, it } from 'bun:test'
import { createEventEnvelope, validateEventEnvelope } from '../../../packages/events/src/index.ts'

describe('createEventEnvelope', () => {
  it('creates an envelope with required fields and provided optional fields', () => {
    const payload = { value: 42 }
    const envelope = createEventEnvelope({
      type: 'task.created',
      source: 'm-task',
      payload,
      correlationId: 'correlation-1',
      traceId: 'trace-1',
      causationId: 'cause-1',
      subject: 'task-1'
    })

    expect(envelope.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(envelope.type).toBe('task.created')
    expect(envelope.version).toBe('v0')
    expect(envelope.source).toBe('m-task')
    expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp)
    expect(envelope.payload).toBe(payload)
    expect(envelope.correlationId).toBe('correlation-1')
    expect(envelope.traceId).toBe('trace-1')
    expect(envelope.causationId).toBe('cause-1')
    expect(envelope.subject).toBe('task-1')
  })

  it('omits optional fields when they are not provided', () => {
    const envelope = createEventEnvelope({
      type: 'task.created',
      source: 'm-task',
      payload: { value: 42 }
    })

    expect('correlationId' in envelope).toBe(false)
    expect('traceId' in envelope).toBe(false)
    expect('causationId' in envelope).toBe(false)
    expect('subject' in envelope).toBe(false)
  })

  it('creates different IDs across calls', () => {
    const first = createEventEnvelope({ type: 'task.created', source: 'm-task', payload: {} })
    const second = createEventEnvelope({ type: 'task.created', source: 'm-task', payload: {} })

    expect(first.id).not.toBe(second.id)
  })
})

describe('validateEventEnvelope', () => {
  const validEnvelope = {
    id: 'event-1',
    type: 'task.created',
    version: 'v0',
    source: 'm-task',
    timestamp: '2026-06-15T00:00:00.000Z',
    payload: { value: 42 }
  }

  it('returns ok for a valid envelope', () => {
    const result = validateEventEnvelope(validEnvelope)

    expect(result).toEqual({ ok: true, value: validEnvelope })
  })

  it.each([
    ['id', 'missing_id'],
    ['type', 'missing_type'],
    ['version', 'missing_version'],
    ['source', 'missing_source'],
    ['timestamp', 'invalid_timestamp'],
    ['payload', 'missing_payload']
  ])('returns err when %s is missing', (field, code) => {
    const envelope = { ...validEnvelope }
    delete envelope[field as keyof typeof envelope]

    const result = validateEventEnvelope(envelope)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(code)
  })

  it('returns err when timestamp format is invalid', () => {
    const result = validateEventEnvelope({ ...validEnvelope, timestamp: 'not-a-date' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid_timestamp')
  })

  it('passes an envelope with extra fields', () => {
    const envelope = { ...validEnvelope, extra: 'field' }
    const result = validateEventEnvelope(envelope)

    expect(result).toEqual({ ok: true, value: envelope })
  })

  it.each([null, undefined, 'event', 42, true])('returns err for non-object value %p', value => {
    const result = validateEventEnvelope(value)

    expect(result).toEqual({ ok: false, error: ['event_not_object'] })
  })
})
