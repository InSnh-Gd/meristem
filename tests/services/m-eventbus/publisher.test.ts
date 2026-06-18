import { describe, expect, it } from 'bun:test'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  calculatePublishBackoffMs,
  createEventBusPublisher,
  type EventBusPublishError
} from '../../../services/m-eventbus/src/publisher.ts'

type PublishCall = {
  subject: string
  payload: string
  opts?: { msgID?: string; retries?: number; timeout?: number }
}

function createFakeJetStreamEnv() {
  const publishCalls: PublishCall[] = []
  const streamInfos = new Map<string, { config: { subjects: string[]; description?: string } }>()

  const js = {
    publish: async (subject: string, payload: string, opts?: PublishCall['opts']) => {
      publishCalls.push({ subject, payload, opts })
      return { stream: 'MERISTEM_EVENTS', seq: publishCalls.length, duplicate: false }
    }
  }

  const jsm = {
    streams: {
      info: async (name: string) => {
        const value = streamInfos.get(name)
        if (!value) throw new Error('missing_stream')
        return value
      },
      add: async (config: { name: string; subjects: string[]; description?: string }) => {
        streamInfos.set(config.name, { config })
        return { config }
      },
      update: async (name: string, config: { subjects?: string[]; description?: string }) => {
        streamInfos.set(name, {
          config: {
            subjects: config.subjects ?? [],
            description: config.description
          }
        })
        return { config }
      }
    }
  }

  return { js, jsm, publishCalls }
}

describe('eventbus publisher', () => {
  it('publishes active subjects through JetStream with msgID and explicit timeout policy', async () => {
    const { js, jsm, publishCalls } = createFakeJetStreamEnv()
    const publisher = await createEventBusPublisher({
      nc: { flush: async () => undefined } as never,
      createJetStreamClient: () => js as never,
      createJetStreamManager: async () => jsm as never
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      subject: 'policy.decision.created.v0',
      payload: { decisionId: 'pd-1', actor: 'operator' }
    })

    await publisher.publish('policy.decision.created.v0', event)

    expect(publishCalls).toHaveLength(1)
    expect(publishCalls[0]).toMatchObject({
      subject: 'policy.decision.created.v0',
      opts: { msgID: event.id, retries: 0, timeout: 1000 }
    })
  })

  it('retries failed publishes with exponential backoff before succeeding', async () => {
    const publishCalls: PublishCall[] = []
    const sleepCalls: number[] = []
    const streamInfos = new Map<string, { config: { subjects: string[]; description?: string } }>()
    let failuresRemaining = 2
    const js = {
      publish: async (subject: string, payload: string, opts?: PublishCall['opts']) => {
        publishCalls.push({ subject, payload, opts })
        if (failuresRemaining > 0 && subject === 'policy.decision.created.v0') {
          failuresRemaining -= 1
          throw new Error('temporary_publish_failure')
        }
        return { stream: 'MERISTEM_EVENTS', seq: publishCalls.length, duplicate: false }
      }
    }
    const jsm = {
      streams: {
        info: async (name: string) => {
          const value = streamInfos.get(name)
          if (!value) throw new Error('missing_stream')
          return value
        },
        add: async (config: { name: string; subjects: string[]; description?: string }) => {
          streamInfos.set(config.name, { config })
          return { config }
        },
        update: async (name: string, config: { subjects?: string[]; description?: string }) => {
          streamInfos.set(name, {
            config: {
              subjects: config.subjects ?? [],
              description: config.description
            }
          })
          return { config }
        }
      }
    }
    const publisher = await createEventBusPublisher({
      nc: { flush: async () => undefined } as never,
      createJetStreamClient: () => js as never,
      createJetStreamManager: async () => jsm as never,
      publishRetries: 2,
      retryBaseMs: 100,
      retryMaxMs: 2000,
      sleep: async ms => {
        sleepCalls.push(ms)
      },
      random: () => 0
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      subject: 'policy.decision.created.v0',
      payload: { decisionId: 'pd-1', actor: 'operator' }
    })

    await publisher.publish('policy.decision.created.v0', event)

    expect(publishCalls).toHaveLength(3)
    expect(sleepCalls).toEqual([100, 200])
  })

  it('rejects non-allowlisted subjects before publish', async () => {
    const { js, jsm } = createFakeJetStreamEnv()
    const publisher = await createEventBusPublisher({
      nc: { flush: async () => undefined } as never,
      createJetStreamClient: () => js as never,
      createJetStreamManager: async () => jsm as never
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      payload: { decisionId: 'pd-1' }
    })

    await expect(publisher.publish('unknown.subject.v0', event)).rejects.toMatchObject({
      code: 'subject_not_allowed'
    } satisfies Partial<EventBusPublishError>)
  })

  it('writes publish failures to the DLQ subject', async () => {
    const publishCalls: PublishCall[] = []
    const streamInfos = new Map<string, { config: { subjects: string[]; description?: string } }>()
    let failuresRemaining = 3
    const js = {
      publish: async (subject: string, payload: string, opts?: PublishCall['opts']) => {
        publishCalls.push({ subject, payload, opts })
        if (failuresRemaining > 0 && subject === 'policy.decision.created.v0') {
          failuresRemaining -= 1
          throw new Error('jetstream_unavailable')
        }
        return { stream: 'MERISTEM_EVENTS', seq: publishCalls.length, duplicate: false }
      }
    }
    const jsm = {
      streams: {
        info: async (name: string) => {
          const value = streamInfos.get(name)
          if (!value) throw new Error('missing_stream')
          return value
        },
        add: async (config: { name: string; subjects: string[]; description?: string }) => {
          streamInfos.set(config.name, { config })
          return { config }
        },
        update: async (name: string, config: { subjects?: string[]; description?: string }) => {
          streamInfos.set(name, {
            config: {
              subjects: config.subjects ?? [],
              description: config.description
            }
          })
          return { config }
        }
      }
    }
    const publisher = await createEventBusPublisher({
      nc: { flush: async () => undefined } as never,
      createJetStreamClient: () => js as never,
      createJetStreamManager: async () => jsm as never
    })

    const event = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      subject: 'policy.decision.created.v0',
      payload: { decisionId: 'pd-1', actor: 'operator' }
    })

    await expect(publisher.publish('policy.decision.created.v0', event)).rejects.toMatchObject({
      code: 'publish_failed'
    } satisfies Partial<EventBusPublishError>)

    expect(publishCalls.map(call => call.subject)).toEqual([
      'policy.decision.created.v0',
      'policy.decision.created.v0',
      'policy.decision.created.v0',
      'meventbus.publish.failed.v0'
    ])
    const failedPublishCall = publishCalls.at(-1)
    if (!failedPublishCall) throw new Error('expected failed publish call')
    expect(JSON.parse(failedPublishCall.payload)).toMatchObject({
      payload: {
        callerService: 'm-policy',
        actor: 'operator',
        eventType: 'policy.decision.created',
        attempts: 3,
        retryBaseMs: 100,
        retryMaxMs: 2000,
        timeoutMs: 1000
      }
    })
  })

  it('caps publish backoff using the configured max value', () => {
    expect(calculatePublishBackoffMs(1, 100, 2000, () => 0)).toBe(100)
    expect(calculatePublishBackoffMs(2, 100, 2000, () => 0)).toBe(200)
    expect(calculatePublishBackoffMs(6, 100, 2000, () => 0)).toBe(2000)
  })

  it('exposes a queryable publish metrics summary with totals, subjects, and latest failures', async () => {
    const { js, jsm } = createFakeJetStreamEnv()
    const publisher = await createEventBusPublisher({
      nc: { flush: async () => undefined } as never,
      createJetStreamClient: () => js as never,
      createJetStreamManager: async () => jsm as never
    })

    const successEvent = createEventEnvelope({
      type: 'policy.decision.created',
      source: 'm-policy',
      subject: 'policy.decision.created.v0',
      payload: { decisionId: 'pd-1', actor: 'operator' }
    })

    await publisher.publish('policy.decision.created.v0', successEvent)
    await publisher.reportRejected({
      subject: 'policy.decision.created.v0',
      event: successEvent,
      reason: 'subject_mismatch',
      errors: ['subject_mismatch']
    })

    const summary = publisher.publishMetricsSummary()
    expect(summary.service).toBe('m-eventbus')
    expect(summary.totals).toMatchObject({ success: 1, rejected: 1, failed: 0, retryAttempts: 0 })
    expect(summary.subjects).toContainEqual(
      expect.objectContaining({
        subject: 'policy.decision.created.v0',
        success: 1,
        rejected: 1,
        failed: 0
      })
    )
    expect(summary.lastRejected).toMatchObject({
      failedSubject: 'policy.decision.created.v0',
      reason: 'subject_mismatch',
      callerService: 'm-policy',
      actor: 'operator'
    })
  })
})
