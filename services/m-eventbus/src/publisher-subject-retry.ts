import type { JetStreamManager } from '@nats-io/jetstream'
import {
  documentedEventBusSubjects,
  eventBusOperationalSubjects
} from '../../../packages/events/src/subject-catalog.ts'

export const DEFAULT_EVENTS_STREAM = 'MERISTEM_EVENTS'
export const DEFAULT_DLQ_STREAM = 'MERISTEM_EVENTBUS_DLQ'
export const DEFAULT_PUBLISH_RETRIES = 2
export const DEFAULT_PUBLISH_TIMEOUT_MS = 1000
export const DEFAULT_RETRY_BASE_MS = 100
export const DEFAULT_RETRY_MAX_MS = 2000
export type StreamNames = { events: string; dlq: string }
/** 发布退避采用指数增长与正向抖动，避免短暂故障时同步重试放大冲击。 */
export function calculatePublishBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt))
  const cappedBase = Math.min(baseMs * 2 ** (normalizedAttempt - 1), maxMs)
  return Math.min(
    cappedBase + Math.floor(cappedBase * 0.2 * Math.min(Math.max(random(), 0), 1)),
    maxMs
  )
}
async function ensureStream(
  jsm: JetStreamManager,
  input: { name: string; subjects: string[]; description: string }
) {
  try {
    const info = await jsm.streams.info(input.name)
    const currentSubjects = new Set(info.config.subjects ?? [])
    const nextSubjects = new Set(input.subjects)
    if (
      currentSubjects.size !== nextSubjects.size ||
      input.subjects.some(subject => !currentSubjects.has(subject)) ||
      info.config.description !== input.description
    )
      await jsm.streams.update(input.name, {
        ...info.config,
        description: input.description,
        subjects: input.subjects
      })
  } catch {
    await jsm.streams.add({
      name: input.name,
      subjects: input.subjects,
      description: input.description,
      retention: 'limits',
      storage: 'file',
      discard: 'old',
      duplicate_window: 120_000_000_000
    })
  }
}
/** 将文档化业务 subject 与 operational subject 分别注册到对应 JetStream stream。 */
export async function ensureStreamSubjects(jsm: JetStreamManager, streamNames: StreamNames) {
  await ensureStream(jsm, {
    name: streamNames.events,
    subjects: documentedEventBusSubjects.filter(
      subject => !eventBusOperationalSubjects.some(operational => operational === subject)
    ),
    description: 'Meristem documented publish subjects'
  })
  await ensureStream(jsm, {
    name: streamNames.dlq,
    subjects: [...eventBusOperationalSubjects],
    description: 'Meristem EventBus rejected/failed publish events'
  })
}
