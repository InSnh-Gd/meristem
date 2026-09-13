import { describe, expect, it } from 'bun:test'
import {
  createMNetNetworkEventIntent,
  dispatchPendingNetworkEvents,
  type MNetNetworkEventIntent,
  type MNetNetworkEventOutboxStore
} from './network-event-outbox.ts'

/**
 * 网络生命周期事件 outbox 的直接 seam 测试（ADR-N05）。
 * 覆盖：at-least-once 投递、失败保留 pending + lastError、读取/发布故障降级、墓碑查询。
 */

type IntentOverrides = {
  subject?: 'mnet.network.created.v0' | 'mnet.network.deleted.v0'
  networkId?: string
  correlationId?: string
}

function intentFixture(overrides: IntentOverrides = {}): MNetNetworkEventIntent {
  const networkId = overrides.networkId ?? 'network-1'
  return createMNetNetworkEventIntent(
    networkId,
    overrides.subject ?? 'mnet.network.created.v0',
    { networkId, name: 'primary', profileVersion: 'm-net@0.3.0' },
    overrides.correlationId ?? 'corr-1',
    '2026-09-13T00:00:00.000Z'
  )
}

type RecordingStore = MNetNetworkEventOutboxStore & {
  published: Array<{ intentId: string; publishedAt: string }>
  failures: Array<{ intentId: string; errorCode: string }>
  /** 记录每次 listPendingEventIntents 收到的 intentId 过滤参数。 */
  listedIntentIds: Array<string | undefined>
}

function recordingStore(seed: MNetNetworkEventIntent[]): RecordingStore {
  const store: RecordingStore = {
    published: [],
    failures: [],
    listedIntentIds: [],
    async listPendingEventIntents(intentId) {
      store.listedIntentIds.push(intentId)
      return intentId ? seed.filter(intent => intent.intentId === intentId) : seed
    },
    async markEventIntentPublished(intentId, publishedAt) {
      store.published.push({ intentId, publishedAt })
    },
    async recordEventIntentFailure(intentId, errorCode) {
      store.failures.push({ intentId, errorCode })
    }
  }
  return store
}

describe('network lifecycle event outbox dispatch', () => {
  it('publishes a pending intent and marks it published', async () => {
    const intent = intentFixture()
    const store = recordingStore([intent])
    const published: Array<{
      subject: string
      type: string
      payload: unknown
      correlationId: string | undefined
    }> = []

    const result = await dispatchPendingNetworkEvents({
      store,
      events: {
        async publish(subject, type, payload, correlationId) {
          published.push({ subject, type, payload, correlationId })
        }
      }
    })

    expect(result).toEqual({ status: 'published', pendingSubjects: [] })
    expect(published).toHaveLength(1)
    // envelope type 为去 `.v0` 后缀的 subject；correlationId 与 Core 审计同值。
    expect(published[0]?.subject).toBe('mnet.network.created.v0')
    expect(published[0]?.type).toBe('mnet.network.created')
    expect(published[0]?.correlationId).toBe('corr-1')
    expect(store.published).toEqual([
      { intentId: intent.intentId, publishedAt: expect.any(String) }
    ])
  })

  it('keeps the intent pending and records lastError when publish fails (at-least-once retry)', async () => {
    const intent = intentFixture()
    const store = recordingStore([intent])

    const result = await dispatchPendingNetworkEvents({
      store,
      events: {
        async publish() {
          throw new Error('eventbus offline')
        }
      }
    })

    expect(result).toEqual({ status: 'pending', pendingSubjects: ['mnet.network.created.v0'] })
    expect(store.failures).toEqual([{ intentId: intent.intentId, errorCode: 'eventbus offline' }])
    // 未标记 published：权威变更已提交，事件留待 sweep 重试。
    expect(store.published).toEqual([])
  })

  it('reports pending without throwing when event intent read fails', async () => {
    const store = recordingStore([])
    store.listPendingEventIntents = async () => {
      throw new Error('postgres down')
    }

    const result = await dispatchPendingNetworkEvents({ store })

    expect(result).toEqual({ status: 'pending', pendingSubjects: [] })
  })

  it('leaves intents pending when no event publisher is wired', async () => {
    const store = recordingStore([intentFixture()])

    const result = await dispatchPendingNetworkEvents({ store })

    expect(result).toEqual({ status: 'pending', pendingSubjects: ['mnet.network.created.v0'] })
    expect(store.published).toEqual([])
  })

  it('scopes the dispatch to a single intent id when one is supplied', async () => {
    // 内联投递只应触碰本次变更的 intent，不能扫描整个 pending 积压（DFW-050）。
    const created = intentFixture()
    const deleted = intentFixture({ subject: 'mnet.network.deleted.v0', networkId: 'network-2' })
    const store = recordingStore([created, deleted])
    const published: string[] = []

    const result = await dispatchPendingNetworkEvents(
      {
        store,
        events: {
          async publish(subject) {
            published.push(subject)
          }
        }
      },
      deleted.intentId
    )

    expect(store.listedIntentIds).toEqual([deleted.intentId])
    expect(result).toEqual({ status: 'published', pendingSubjects: [] })
    expect(published).toEqual(['mnet.network.deleted.v0'])
    expect(store.published).toEqual([
      { intentId: deleted.intentId, publishedAt: expect.any(String) }
    ])
  })
})
