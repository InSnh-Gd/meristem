import { describe, expect, it } from 'bun:test'
import { fromPartial } from '@total-typescript/shoehorn'
import type { MNetDb } from '@m-net/clients.ts'
import { createNetworkService } from '@m-net/network-service.ts'
import { createInMemoryProfileStore } from '@m-net/profile/profile-store.ts'
import {
  dispatchPendingNetworkEvents,
  type MNetNetworkEventIntent,
  type MNetNetworkEventOutboxStore
} from '@m-net/data-plane/network-event-outbox.ts'

/**
 * 网络生命周期事件的 EventBus 不可用故障模式（ADR-N05 / DFW-043）。
 *
 * 关键不变式：EventBus 不可用**不能**把已提交的网络变更翻成失败，也不能伪造已投递；
 * 事件必须留在 durable pending intent 里，等 EventBus 恢复后由 sweep 以 at-least-once 补发。
 * 这与改动前「Core 内联发布失败即 503，且已提交变更无补发路径」形成对照。
 */

/** 捕获 createNetwork 事务内写入的 event-intent 行，并归一化为 outbox intent。 */
function createIntentCapturingDb() {
  const captured: MNetNetworkEventIntent[] = []
  // 同一个事务里既插网络行也插 event-intent；只有后者带 subject 字段。
  const captureIntent = (row: unknown) => {
    if (typeof row !== 'object' || row === null || !('subject' in row)) return
    const record = row as Record<string, unknown>
    captured.push({
      intentId: String(record.intentId),
      subject: String(record.subject),
      payload: record.payload,
      status: record.status === 'published' ? 'published' : 'pending',
      correlationId: String(record.correlationId),
      networkId: String(record.networkId),
      createdAt: new Date(record.createdAt as string | Date).toISOString(),
      ...(record.publishedAt
        ? { publishedAt: new Date(record.publishedAt as string | Date).toISOString() }
        : {}),
      ...(record.lastError ? { lastError: String(record.lastError) } : {})
    })
  }
  const db = fromPartial<MNetDb>({
    select: () => ({
      from: () => {
        const chain = Object.assign(Promise.resolve([]), {
          where: () => chain,
          limit: () => chain,
          for: () => chain
        })
        return chain
      }
    }),
    transaction: async (fn: (value: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => {
            const chain = Object.assign(Promise.resolve([]), {
              where: () => chain,
              limit: () => chain,
              for: () => chain
            })
            return chain
          }
        }),
        insert: () => ({
          values: (row: unknown) => {
            captureIntent(row)
            return Promise.resolve([])
          }
        })
      })
  })
  return { db, captured }
}

describe('M-Net network lifecycle EventBus unavailability', () => {
  it('commits the mutation and keeps the event as a durable pending intent', async () => {
    const { db, captured } = createIntentCapturingDb()
    const service = createNetworkService({ db, profileStore: createInMemoryProfileStore() })

    const result = await service.createNetwork({ name: 'net-1', correlationId: 'corr-fm-1' })

    expect(result.ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.subject).toBe('mnet.network.created.v0')
    expect(captured[0]?.status).toBe('pending')
    expect(captured[0]?.correlationId).toBe('corr-fm-1')
  })

  it('retries the pending intent on the sweep and publishes once EventBus recovers', async () => {
    const { db, captured } = createIntentCapturingDb()
    const service = createNetworkService({ db, profileStore: createInMemoryProfileStore() })
    await service.createNetwork({ name: 'net-1', correlationId: 'corr-fm-2' })
    const intent = captured[0]
    if (!intent) throw new Error('expected a captured network event intent')

    const pending: MNetNetworkEventIntent[] = [intent]
    const markedPublished: string[] = []
    const failures: string[] = []
    const store: MNetNetworkEventOutboxStore = {
      listPendingEventIntents: async () => pending.filter(i => i.status === 'pending'),
      markEventIntentPublished: async intentId => {
        markedPublished.push(intentId)
        const found = pending.find(i => i.intentId === intentId)
        if (found) found.status = 'published'
      },
      recordEventIntentFailure: async (_intentId, errorCode) => {
        failures.push(errorCode)
      }
    }

    // EventBus 不可用：不抛错、不伪造成功，intent 保持 pending 并记录 lastError。
    const degraded = await dispatchPendingNetworkEvents({
      store,
      events: {
        async publish() {
          throw new Error('eventbus.unavailable')
        }
      }
    })
    expect(degraded).toEqual({ status: 'pending', pendingSubjects: ['mnet.network.created.v0'] })
    expect(failures).toEqual(['eventbus.unavailable'])
    expect(markedPublished).toEqual([])

    // EventBus 恢复：同一条 pending intent 被补发并标记 published。
    const published: string[] = []
    const recovered = await dispatchPendingNetworkEvents({
      store,
      events: {
        async publish(subject, _type, _payload, correlationId) {
          published.push(`${subject}:${correlationId}`)
        }
      }
    })
    expect(recovered).toEqual({ status: 'published', pendingSubjects: [] })
    expect(published).toEqual(['mnet.network.created.v0:corr-fm-2'])
    expect(markedPublished).toEqual([intent.intentId])
  })
})
