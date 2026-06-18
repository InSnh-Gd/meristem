const DEFAULT_EVENTS_STREAM = 'MERISTEM_EVENTS'
const DEFAULT_DLQ_STREAM = 'MERISTEM_EVENTBUS_DLQ'
const DEFAULT_PUBLISH_RETRIES = 2
const DEFAULT_PUBLISH_TIMEOUT_MS = 1000
const DEFAULT_RETRY_BASE_MS = 100
const DEFAULT_RETRY_MAX_MS = 2000

export type EventBusPublisherRuntimeConfig = {
  eventsStreamName: string
  dlqStreamName: string
  publishRetries: number
  publishTimeoutMs: number
  retryBaseMs: number
  retryMaxMs: number
}

function readPositiveInteger(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * M-EventBus 发布面配置统一集中读取，避免 stream/retry/timeout 语义散落在 publisher 内部常量里。
 */
export function readEventBusPublisherRuntimeConfig(): EventBusPublisherRuntimeConfig {
  return {
    eventsStreamName: process.env.MERISTEM_EVENTBUS_STREAM ?? DEFAULT_EVENTS_STREAM,
    dlqStreamName: process.env.MERISTEM_EVENTBUS_DLQ_STREAM ?? DEFAULT_DLQ_STREAM,
    publishRetries: readPositiveInteger(
      'MERISTEM_EVENTBUS_PUBLISH_RETRIES',
      DEFAULT_PUBLISH_RETRIES
    ),
    publishTimeoutMs: readPositiveInteger(
      'MERISTEM_EVENTBUS_PUBLISH_TIMEOUT_MS',
      DEFAULT_PUBLISH_TIMEOUT_MS
    ),
    retryBaseMs: readPositiveInteger('MERISTEM_EVENTBUS_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS),
    retryMaxMs: readPositiveInteger('MERISTEM_EVENTBUS_RETRY_MAX_MS', DEFAULT_RETRY_MAX_MS)
  }
}
