import { describe, expect, it } from 'bun:test'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { handleEventBusOperationalEnvelope } from '../../../services/m-log/src/eventbus-operational-consumer.ts'

describe('m-log eventbus operational consumer', () => {
  it('writes rejected EventBus subjects as warn Full Logs', async () => {
    const writes: Array<Record<string, unknown>> = []
    const event = createEventEnvelope({
      type: 'meventbus.publish.rejected',
      source: 'm-eventbus',
      subject: 'meventbus.publish.rejected.v0',
      correlationId: 'corr-1',
      traceId: 'trace-1',
      payload: {
        failedSubject: 'unknown.subject.v0',
        callerService: 'm-policy',
        actor: 'operator',
        eventType: 'policy.decision.created',
        reason: 'subject_not_allowed',
        errors: ['subject_not_allowed:unknown.subject.v0'],
        originalEvent: { id: 'evt-1' }
      }
    })

    await handleEventBusOperationalEnvelope('meventbus.publish.rejected.v0', event, async input => {
      writes.push(input as Record<string, unknown>)
      return { id: 'log-1', timestamp: new Date().toISOString(), ...input }
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      level: 'warn',
      source: 'm-eventbus',
      message: 'EventBus rejected publish for unknown.subject.v0 from m-policy by operator',
      correlationId: 'corr-1',
      traceId: 'trace-1'
    })
  })

  it('writes failed EventBus publishes as error Full Logs', async () => {
    const writes: Array<Record<string, unknown>> = []
    const event = createEventEnvelope({
      type: 'meventbus.publish.failed',
      source: 'm-eventbus',
      subject: 'meventbus.publish.failed.v0',
      payload: {
        failedSubject: 'policy.decision.created.v0',
        eventId: 'evt-2',
        source: 'm-policy',
        callerService: 'm-policy',
        actor: 'operator',
        eventType: 'policy.decision.created',
        reason: 'publish_failed',
        attempts: 3,
        retryBaseMs: 100,
        retryMaxMs: 2000,
        timeoutMs: 1000,
        errorMessage: 'jetstream_unavailable',
        originalEvent: { id: 'evt-2' }
      }
    })

    await handleEventBusOperationalEnvelope('meventbus.publish.failed.v0', event, async input => {
      writes.push(input as Record<string, unknown>)
      return { id: 'log-1', timestamp: new Date().toISOString(), ...input }
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      level: 'error',
      source: 'm-eventbus',
      message: 'EventBus publish failed for policy.decision.created.v0 from m-policy by operator'
    })
    expect((writes[0].payload as Record<string, unknown>).attempts).toBe(3)
  })

  it('rejects invalid operational payloads before writing Full Logs', async () => {
    const event = createEventEnvelope({
      type: 'meventbus.publish.failed',
      source: 'm-eventbus',
      subject: 'meventbus.publish.failed.v0',
      payload: {
        failedSubject: 'policy.decision.created.v0',
        source: 'm-policy'
      }
    })

    await expect(
      handleEventBusOperationalEnvelope('meventbus.publish.failed.v0', event, async input => {
        return { id: 'log-1', timestamp: new Date().toISOString(), ...input }
      })
    ).rejects.toThrow()
  })
})
