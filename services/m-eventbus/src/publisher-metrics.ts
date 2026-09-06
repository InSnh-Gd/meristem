import type {
  EventBusLastFailedSnapshotFromSchema,
  EventBusLastRejectedSnapshotFromSchema,
  EventBusPublishMetricsSummaryFromSchema,
  EventBusPublishOutcomeFromSchema
} from '../../../packages/contracts/src/index.ts'
import { recordCounter } from '../../../packages/telemetry/src/index.ts'

/**
 * EventBus 发布指标关注点：低基数 outcome 计数、subject 级聚合、
 * 最近 rejected/failed 快照以及用于 operational event 归因的事件身份读取。
 * 仅做纯内存状态维护与 metrics 上报，不接触 NATS。
 */

export type EventBusPublishOutcome = { eventId: string }

export type EventIdentity = {
  eventId?: string
  source?: string
  actor?: string
  eventType?: string
  correlationId?: string
  traceId?: string
  causationId?: string
}

export type MutableSubjectMetrics = {
  success: number
  rejected: number
  failed: number
  retryAttempts: number
  lastOutcome?: EventBusPublishOutcomeFromSchema
  lastOutcomeAt?: string
}

export type PublishMetricsState = {
  windowStartedAt: string
  totals: {
    success: number
    rejected: number
    failed: number
    retryAttempts: number
  }
  subjects: Map<string, MutableSubjectMetrics>
  lastRejected?: EventBusLastRejectedSnapshotFromSchema
  lastFailed?: EventBusLastFailedSnapshotFromSchema
}

export function readOptionalStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

export function isoNow(): string {
  return new Date().toISOString()
}

/**
 * 失败侧信号需要统一归因维度，避免 rejected/failed 两类 operational event 字段漂移。
 */
export function readEventIdentity(event: unknown): EventIdentity {
  const eventId = readOptionalStringField(event, 'id')
  const source = readOptionalStringField(event, 'source')
  const eventType = readOptionalStringField(event, 'type')
  const correlationId = readOptionalStringField(event, 'correlationId')
  const traceId = readOptionalStringField(event, 'traceId')
  const causationId = readOptionalStringField(event, 'causationId')
  const payload =
    typeof event === 'object' && event !== null
      ? (event as { payload?: unknown }).payload
      : undefined
  const actor = readOptionalStringField(payload, 'actor')
  return {
    ...(eventId ? { eventId } : {}),
    ...(source ? { source } : {}),
    ...(actor ? { actor } : {}),
    ...(eventType ? { eventType } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(causationId ? { causationId } : {})
  }
}

/**
 * 指标只保留低基数标签：subject/source/outcome/reason，避免把 actor 等高基数字段写进 metrics。
 */
export function recordPublishOutcome(
  outcome: 'success' | 'rejected' | 'failed',
  input: { subject: string; source?: string | undefined; reason?: string | undefined }
): void {
  recordCounter('eventbus.publish.outcomes_total', 1, {
    outcome,
    subject: input.subject,
    ...(input.source ? { source: input.source } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  })
}

export function recordRetryAttempts(
  subject: string,
  source: string | undefined,
  attempts: number
): void {
  if (attempts <= 1) return
  recordCounter('eventbus.publish.retry_attempts_total', attempts - 1, {
    subject,
    ...(source ? { source } : {}),
    outcome: 'retry'
  })
}

export function ensureSubjectMetrics(
  metricsState: PublishMetricsState,
  subject: string
): MutableSubjectMetrics {
  let entry = metricsState.subjects.get(subject)
  if (!entry) {
    entry = { success: 0, rejected: 0, failed: 0, retryAttempts: 0 }
    metricsState.subjects.set(subject, entry)
  }
  return entry
}

export function applySubjectOutcome(
  metricsState: PublishMetricsState,
  subject: string,
  outcome: EventBusPublishOutcomeFromSchema,
  retryAttempts = 0
): void {
  const at = isoNow()
  const subjectMetrics = ensureSubjectMetrics(metricsState, subject)
  subjectMetrics[outcome] += 1
  subjectMetrics.retryAttempts += retryAttempts
  subjectMetrics.lastOutcome = outcome
  subjectMetrics.lastOutcomeAt = at

  metricsState.totals[outcome] += 1
  metricsState.totals.retryAttempts += retryAttempts
}

export function createPublishMetricsState(): PublishMetricsState {
  return {
    windowStartedAt: isoNow(),
    totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
    subjects: new Map()
  }
}

export function snapshotPublishMetrics(
  metricsState: PublishMetricsState
): EventBusPublishMetricsSummaryFromSchema {
  return {
    service: 'm-eventbus',
    generatedAt: isoNow(),
    windowStartedAt: metricsState.windowStartedAt,
    totals: { ...metricsState.totals },
    subjects: [...metricsState.subjects.entries()]
      .map(([subject, entry]) => ({
        subject,
        success: entry.success,
        rejected: entry.rejected,
        failed: entry.failed,
        retryAttempts: entry.retryAttempts,
        ...(entry.lastOutcome ? { lastOutcome: entry.lastOutcome } : {}),
        ...(entry.lastOutcomeAt ? { lastOutcomeAt: entry.lastOutcomeAt } : {})
      }))
      .sort((left, right) => left.subject.localeCompare(right.subject)),
    ...(metricsState.lastRejected ? { lastRejected: metricsState.lastRejected } : {}),
    ...(metricsState.lastFailed ? { lastFailed: metricsState.lastFailed } : {})
  }
}
