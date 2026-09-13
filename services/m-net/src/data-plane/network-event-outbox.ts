import { asc, eq } from 'drizzle-orm'
import {
  mnetNetworkEventIntents,
  mnetNetworkTombstones
} from '../../../../packages/db/src/schema.ts'
import type { ProfileEvents } from '../event-log-factories.ts'
import type { MNetDb } from '../types.ts'

/**
 * 网络生命周期事件 outbox（ADR-N05）。
 *
 * 「谁拥有权威变更，谁拥有该变更的事件」：变更与 event-intent 在同一个 PostgreSQL 事务里
 * 提交，投递由本模块的 dispatcher 以 at-least-once 语义补发。发布者因此从 Core 迁到 M-Net
 * ——只有 M-Net 能在同一事务里既写网络状态、又写待发布事件。
 *
 * network_id 刻意不设 FK 到 networks.id：删除 intent 必须活过它描述的网络行本身。
 */

export const networkLifecycleEventSubjects = [
  'mnet.network.created.v0',
  'mnet.membership.joined.v0',
  'mnet.network.deleted.v0',
  'mnet.membership.removed.v0'
] as const

export type NetworkLifecycleEventSubject = (typeof networkLifecycleEventSubjects)[number]

export type MNetNetworkEventIntent = {
  intentId: string
  subject: string
  payload: unknown
  status: 'pending' | 'published'
  correlationId: string
  networkId: string
  createdAt: string
  publishedAt?: string | undefined
  lastError?: string | undefined
}

/**
 * 在变更事务内构造事件意图。subject 以字面量传入调用点，供 schema-coverage 漂移守卫
 * 静态识别「M-Net 是这些网络生命周期事件的发布者」。
 */
export function createMNetNetworkEventIntent(
  networkId: string,
  subject: NetworkLifecycleEventSubject,
  payload: unknown,
  correlationId: string,
  createdAt: string
): MNetNetworkEventIntent {
  return {
    intentId: `network-event-intent-${crypto.randomUUID()}`,
    subject,
    payload,
    status: 'pending',
    correlationId,
    networkId,
    createdAt
  }
}

export type MNetNetworkEventIntentRow = {
  intentId: string
  subject: string
  payload: unknown
  status: string
  correlationId: string
  networkId: string
  createdAt: Date
  publishedAt: Date | null
  lastError: string | null
}

/** 事件意图到 outbox 行的显式映射：jsonb payload 原样落库，时间戳转 Date。 */
export function networkEventIntentRow(intent: MNetNetworkEventIntent): MNetNetworkEventIntentRow {
  return {
    intentId: intent.intentId,
    subject: intent.subject,
    payload: intent.payload,
    status: intent.status,
    correlationId: intent.correlationId,
    networkId: intent.networkId,
    createdAt: new Date(intent.createdAt),
    publishedAt: intent.publishedAt === undefined ? null : new Date(intent.publishedAt),
    lastError: intent.lastError ?? null
  }
}

export type MNetNetworkEventOutboxStore = {
  listPendingEventIntents(): Promise<MNetNetworkEventIntent[]>
  markEventIntentPublished(intentId: string, publishedAt: string): Promise<void>
  recordEventIntentFailure(intentId: string, errorCode: string): Promise<void>
  /** 删除墓碑：区分「删过」与「从未存在」，是 DELETE 幂等语义的权威判据。 */
  hasTombstone(networkId: string): Promise<boolean>
}

function rowToIntent(row: {
  intentId: string
  subject: string
  payload: unknown
  status: string
  correlationId: string
  networkId: string
  createdAt: Date
  publishedAt: Date | null
  lastError: string | null
}): MNetNetworkEventIntent {
  return {
    intentId: row.intentId,
    subject: row.subject,
    payload: row.payload,
    status: row.status === 'published' ? 'published' : 'pending',
    correlationId: row.correlationId,
    networkId: row.networkId,
    createdAt: row.createdAt.toISOString(),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
    ...(row.lastError === null ? {} : { lastError: row.lastError })
  }
}

/** PostgreSQL 权威 outbox：与网络变更同库，变更事务直接写入本表。 */
export function createPgMNetNetworkEventOutboxStore(db: MNetDb): MNetNetworkEventOutboxStore {
  return {
    async listPendingEventIntents() {
      const rows = await db
        .select()
        .from(mnetNetworkEventIntents)
        .where(eq(mnetNetworkEventIntents.status, 'pending'))
        .orderBy(asc(mnetNetworkEventIntents.createdAt))
      return rows.map(rowToIntent)
    },
    async markEventIntentPublished(intentId, publishedAt) {
      await db
        .update(mnetNetworkEventIntents)
        .set({ status: 'published', publishedAt: new Date(publishedAt), lastError: null })
        .where(eq(mnetNetworkEventIntents.intentId, intentId))
    },
    async recordEventIntentFailure(intentId, errorCode) {
      await db
        .update(mnetNetworkEventIntents)
        .set({ lastError: errorCode })
        .where(eq(mnetNetworkEventIntents.intentId, intentId))
    },
    async hasTombstone(networkId) {
      const [row] = await db
        .select({ networkId: mnetNetworkTombstones.networkId })
        .from(mnetNetworkTombstones)
        .where(eq(mnetNetworkTombstones.networkId, networkId))
        .limit(1)
      return row !== undefined
    }
  }
}

/** 测试与非数据库组合使用的内存 outbox；语义与 pg 实现一致。 */
export function createInMemoryMNetNetworkEventOutboxStore(): MNetNetworkEventOutboxStore {
  const intents = new Map<string, MNetNetworkEventIntent>()
  const tombstones = new Set<string>()
  return {
    async listPendingEventIntents() {
      return [...intents.values()]
        .filter(intent => intent.status === 'pending')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(intent => structuredClone(intent))
    },
    async markEventIntentPublished(intentId, publishedAt) {
      const intent = intents.get(intentId)
      if (!intent) throw new Error(`network event intent not found: ${intentId}`)
      intents.set(intentId, { ...intent, status: 'published', publishedAt, lastError: undefined })
    },
    async recordEventIntentFailure(intentId, errorCode) {
      const intent = intents.get(intentId)
      if (!intent) throw new Error(`network event intent not found: ${intentId}`)
      intents.set(intentId, { ...intent, lastError: errorCode })
    },
    async hasTombstone(networkId) {
      return tombstones.has(networkId)
    }
  }
}

export type NetworkEventDispatchDeps = {
  store: Pick<
    MNetNetworkEventOutboxStore,
    'listPendingEventIntents' | 'markEventIntentPublished' | 'recordEventIntentFailure'
  >
  events?: Pick<ProfileEvents, 'publish'>
}

export type NetworkEventDispatchResult = {
  status: 'published' | 'pending'
  pendingSubjects: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** v0.3 事件 envelope 的 type 字段是去掉 `.v0` 后缀的 subject。 */
function eventType(subject: string): string {
  return subject.endsWith('.v0') ? subject.slice(0, -3) : subject
}

/**
 * 补发 pending 的网络生命周期事件（at-least-once）。
 * 投递失败保留 pending 并记录 lastError，由 startup 的周期性 sweep 重试；
 * 已提交的权威变更不因投递失败被改写，因此这里只降级为 pending + 告警。
 */
export async function dispatchPendingNetworkEvents(
  deps: NetworkEventDispatchDeps
): Promise<NetworkEventDispatchResult> {
  let pending: MNetNetworkEventIntent[]
  try {
    pending = await deps.store.listPendingEventIntents()
  } catch (error) {
    process.stderr.write(`m-net: network event intent read failed - ${errorMessage(error)}\n`)
    return { status: 'pending', pendingSubjects: [] }
  }

  const pendingSubjects: string[] = []
  for (const intent of pending) {
    if (!deps.events) {
      pendingSubjects.push(intent.subject)
      continue
    }
    try {
      await deps.events.publish(
        intent.subject,
        eventType(intent.subject),
        intent.payload,
        intent.correlationId
      )
    } catch (error) {
      pendingSubjects.push(intent.subject)
      try {
        await deps.store.recordEventIntentFailure(intent.intentId, errorMessage(error))
      } catch (recordError) {
        process.stderr.write(
          `m-net: network event intent failure record degraded - ${errorMessage(recordError)}\n`
        )
      }
      continue
    }
    try {
      await deps.store.markEventIntentPublished(intent.intentId, new Date().toISOString())
    } catch (error) {
      pendingSubjects.push(intent.subject)
      process.stderr.write(
        `m-net: network event intent publish mark degraded - ${errorMessage(error)}\n`
      )
    }
  }

  return {
    status: pendingSubjects.length === 0 ? 'published' : 'pending',
    pendingSubjects
  }
}
