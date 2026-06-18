import { afterEach, describe, expect, it } from 'bun:test'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createEventBusApp } from '../../../services/m-eventbus/src/app.ts'
import { EventBusPublishError } from '../../../services/m-eventbus/src/publisher.ts'

const originalToken = process.env.MERISTEM_INTERNAL_TOKEN

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.MERISTEM_INTERNAL_TOKEN
  } else {
    process.env.MERISTEM_INTERNAL_TOKEN = originalToken
  }
})

describe('m-eventbus app', () => {
  it('rejects publish without the internal token', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
        subjects: []
      }),
      publish: async () => ({ eventId: 'evt-1' }),
      reportRejected: async () => undefined
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      payload: { decisionId: 'dec-1' }
    })
    const response = await app.handle(
      new Request('http://localhost/internal/v0/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'policy.decision.created.v0', event })
      })
    )

    expect(response.status).toBe(401)
  })

  it('rejects invalid event envelopes before publish is called', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    let publishCalls = 0
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
        subjects: []
      }),
      publish: async () => {
        publishCalls += 1
        return { eventId: 'evt-1' }
      },
      reportRejected: async () => undefined
    })

    const response = await app.handle(
      new Request('http://localhost/internal/v0/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-meristem-internal-token': 'shared-token'
        },
        body: JSON.stringify({
          subject: 'policy.decision.created.v0',
          event: {
            id: 'evt-1',
            type: 'policy.decision.created',
            version: 'v0',
            source: 'm-policy',
            timestamp: 'not-an-iso-time',
            payload: { decisionId: 'dec-1' }
          }
        })
      })
    )

    expect(response.status).toBe(422)
    expect(publishCalls).toBe(0)
  })

  it('returns publish metrics summary from the internal metrics route', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 3, rejected: 1, failed: 1, retryAttempts: 2 },
        subjects: [],
        lastFailed: {
          at: '2026-06-18T00:00:00.000Z',
          failedSubject: 'policy.decision.created.v0',
          reason: 'publish_failed',
          attempts: 3,
          errorMessage: 'nats_down'
        }
      }),
      publish: async () => ({ eventId: 'evt-1' }),
      reportRejected: async () => undefined
    })

    const response = await app.handle(
      new Request('http://localhost/internal/v0/metrics/publish-summary', {
        method: 'GET',
        headers: { 'x-meristem-internal-token': 'shared-token' }
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      service: 'm-eventbus',
      totals: { success: 3, rejected: 1, failed: 1, retryAttempts: 2 }
    })
  })

  it('publishes validated envelopes through the dependency adapter', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    let published: { subject: string; eventId: string } | null = null
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
        subjects: []
      }),
      publish: async (subject, event) => {
        published = { subject, eventId: event.id }
        return { eventId: event.id }
      },
      reportRejected: async () => undefined
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      payload: { decisionId: 'dec-1' }
    })
    const response = await app.handle(
      new Request('http://localhost/internal/v0/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-meristem-internal-token': 'shared-token'
        },
        body: JSON.stringify({ subject: 'policy.decision.created.v0', event })
      })
    )

    expect(response.status).toBe(200)
    expect(published).toEqual({ subject: 'policy.decision.created.v0', eventId: event.id })
  })

  it('rejects subjects that are not in the active EventBus allowlist', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    let rejectedReason: string | null = null
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
        subjects: []
      }),
      publish: async () => {
        throw new EventBusPublishError('subject_not_allowed', 'subject_not_allowed:unknown.subject.v0')
      },
      reportRejected: async input => {
        rejectedReason = input.reason
      }
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      payload: { decisionId: 'dec-1' }
    })

    const response = await app.handle(
      new Request('http://localhost/internal/v0/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-meristem-internal-token': 'shared-token'
        },
        body: JSON.stringify({ subject: 'unknown.subject.v0', event })
      })
    )

    expect(response.status).toBe(422)
    expect(rejectedReason).toBe('subject_not_allowed')
  })

  it('maps publish transport failures to 503 responses', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'
    const app = createEventBusApp({
      readiness: async () => ({ ready: true }),
      publishMetricsSummary: () => ({
        service: 'm-eventbus',
        generatedAt: '2026-06-18T00:00:00.000Z',
        windowStartedAt: '2026-06-18T00:00:00.000Z',
        totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
        subjects: []
      }),
      publish: async () => {
        throw new EventBusPublishError('publish_failed', 'nats_down')
      },
      reportRejected: async () => undefined
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      subject: 'policy.decision.created.v0',
      payload: { decisionId: 'dec-1' }
    })

    const response = await app.handle(
      new Request('http://localhost/internal/v0/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-meristem-internal-token': 'shared-token'
        },
        body: JSON.stringify({ subject: 'policy.decision.created.v0', event })
      })
    )

    expect(response.status).toBe(503)
  })
})
