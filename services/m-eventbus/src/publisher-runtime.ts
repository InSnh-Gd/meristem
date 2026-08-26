import {
  type JetStreamClient,
  type JetStreamManager,
  jetstream,
  jetstreamManager
} from '@nats-io/jetstream'
import type { NatsConnection } from '@nats-io/nats-core'
import type {
  EventBusLastFailedSnapshotFromSchema,
  EventBusLastRejectedSnapshotFromSchema,
  EventBusPublishFailedPayloadFromSchema,
  EventBusPublishMetricsSummaryFromSchema,
  EventBusPublishOutcomeFromSchema,
  EventBusRejectedPayloadFromSchema
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope, type MEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  allowedEventBusSubjectSet,
  type eventBusOperationalSubjects
} from '../../../packages/events/src/subject-catalog.ts'
import { createLogger, recordCounter } from '../../../packages/telemetry/src/index.ts'
import {
  calculatePublishBackoffMs,
  DEFAULT_DLQ_STREAM,
  DEFAULT_EVENTS_STREAM,
  DEFAULT_PUBLISH_RETRIES,
  DEFAULT_PUBLISH_TIMEOUT_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  ensureStreamSubjects,
  type StreamNames
} from './publisher-subject-retry.ts'

const logger = createLogger('m-eventbus')
export type EventBusPublishOutcome = { eventId: string }
export type EventBusRejectReason = 'invalid_envelope' | 'subject_not_allowed' | 'subject_mismatch'
export class EventBusPublishError extends Error {
  readonly code: 'subject_not_allowed' | 'subject_mismatch' | 'publish_failed'
  constructor(
    code: 'subject_not_allowed' | 'subject_mismatch' | 'publish_failed',
    message: string
  ) {
    super(message)
    this.code = code
  }
}
export type EventBusRuntimeState = { ready: boolean; lastError?: string }
export type EventBusPublisher = {
  ensureStreams(): Promise<void>
  readiness(): Promise<{ ready: boolean }>
  publishMetricsSummary(): EventBusPublishMetricsSummaryFromSchema
  publish(subject: string, event: MEventEnvelope): Promise<EventBusPublishOutcome>
  reportRejected(input: {
    subject: string
    event: unknown
    reason: EventBusRejectReason
    errors: string[]
  }): Promise<void>
}
type EventBusPublisherOptions = {
  nc: NatsConnection
  eventsStreamName?: string
  dlqStreamName?: string
  publishRetries?: number
  publishTimeoutMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  createJetStreamClient?: (nc: NatsConnection) => JetStreamClient
  createJetStreamManager?: (nc: NatsConnection) => Promise<JetStreamManager>
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}
type EventIdentity = {
  eventId?: string
  source?: string
  actor?: string
  eventType?: string
  correlationId?: string
  traceId?: string
  causationId?: string
}
type MutableSubjectMetrics = {
  success: number
  rejected: number
  failed: number
  retryAttempts: number
  lastOutcome?: EventBusPublishOutcomeFromSchema
  lastOutcomeAt?: string
}
type PublishMetricsState = {
  windowStartedAt: string
  totals: { success: number; rejected: number; failed: number; retryAttempts: number }
  subjects: Map<string, MutableSubjectMetrics>
  lastRejected?: EventBusLastRejectedSnapshotFromSchema
  lastFailed?: EventBusLastFailedSnapshotFromSchema
}
function readOptionalStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}
function readEventIdentity(event: unknown): EventIdentity {
  const payload =
    typeof event === 'object' && event !== null
      ? (event as { payload?: unknown }).payload
      : undefined
  const eventId = readOptionalStringField(event, 'id')
  const source = readOptionalStringField(event, 'source')
  const actor = readOptionalStringField(payload, 'actor')
  const eventType = readOptionalStringField(event, 'type')
  const correlationId = readOptionalStringField(event, 'correlationId')
  const traceId = readOptionalStringField(event, 'traceId')
  const causationId = readOptionalStringField(event, 'causationId')
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
function createDlqEnvelope(
  kind: 'meventbus.publish.rejected' | 'meventbus.publish.failed',
  payload: unknown,
  correlationId?: string,
  traceId?: string
) {
  return createEventEnvelope({
    type: kind,
    source: 'm-eventbus',
    payload,
    subject: `${kind}.v0`,
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {})
  })
}
function isoNow(): string {
  return new Date().toISOString()
}
function ensureSubjectMetrics(state: PublishMetricsState, subject: string): MutableSubjectMetrics {
  let entry = state.subjects.get(subject)
  if (!entry) {
    entry = { success: 0, rejected: 0, failed: 0, retryAttempts: 0 }
    state.subjects.set(subject, entry)
  }
  return entry
}
function applySubjectOutcome(
  state: PublishMetricsState,
  subject: string,
  outcome: EventBusPublishOutcomeFromSchema,
  retryAttempts = 0
) {
  const entry = ensureSubjectMetrics(state, subject)
  entry[outcome] += 1
  entry.retryAttempts += retryAttempts
  entry.lastOutcome = outcome
  entry.lastOutcomeAt = isoNow()
  state.totals[outcome] += 1
  state.totals.retryAttempts += retryAttempts
}
function recordPublishOutcome(
  outcome: 'success' | 'rejected' | 'failed',
  input: { subject: string; source?: string | undefined; reason?: string | undefined }
) {
  recordCounter('eventbus.publish.outcomes_total', 1, {
    outcome,
    subject: input.subject,
    ...(input.source ? { source: input.source } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  })
}
function recordRetryAttempts(subject: string, source: string | undefined, attempts: number) {
  if (attempts > 1)
    recordCounter('eventbus.publish.retry_attempts_total', attempts - 1, {
      subject,
      ...(source ? { source } : {}),
      outcome: 'retry'
    })
}
function snapshotPublishMetrics(
  state: PublishMetricsState
): EventBusPublishMetricsSummaryFromSchema {
  return {
    service: 'm-eventbus',
    generatedAt: isoNow(),
    windowStartedAt: state.windowStartedAt,
    totals: { ...state.totals },
    subjects: [...state.subjects.entries()]
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
    ...(state.lastRejected ? { lastRejected: state.lastRejected } : {}),
    ...(state.lastFailed ? { lastFailed: state.lastFailed } : {})
  }
}
/** JetStream 发布器保留 allowlist、重试、DLQ 与指标的既有可观测契约。 */
export async function createEventBusPublisher(
  options: EventBusPublisherOptions
): Promise<EventBusPublisher> {
  const streamNames = {
    events:
      options.eventsStreamName ?? process.env.MERISTEM_EVENTBUS_STREAM ?? DEFAULT_EVENTS_STREAM,
    dlq: options.dlqStreamName ?? process.env.MERISTEM_EVENTBUS_DLQ_STREAM ?? DEFAULT_DLQ_STREAM
  } satisfies StreamNames
  const retries = options.publishRetries ?? DEFAULT_PUBLISH_RETRIES
  const publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
  const sleep = options.sleep ?? (async (ms: number) => Bun.sleep(ms))
  const random = options.random ?? Math.random
  const jsm = await (options.createJetStreamManager?.(options.nc) ?? jetstreamManager(options.nc))
  const js = options.createJetStreamClient?.(options.nc) ?? jetstream(options.nc)
  const runtimeState: EventBusRuntimeState = { ready: false }
  const metricsState: PublishMetricsState = {
    windowStartedAt: isoNow(),
    totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
    subjects: new Map()
  }
  const markFailure = (message: string) => {
    runtimeState.ready = false
    runtimeState.lastError = message
  }
  const markReady = () => {
    runtimeState.ready = true
    delete runtimeState.lastError
  }
  const publishToJetStream = async (subject: string, event: MEventEnvelope) => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await js.publish(subject, JSON.stringify(event), {
          msgID: event.id,
          retries: 0,
          timeout: publishTimeoutMs
        })
        return { attempts: attempt + 1 }
      } catch (error) {
        if (attempt >= retries)
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            attempts: attempt + 1
          })
        await sleep(calculatePublishBackoffMs(attempt + 1, retryBaseMs, retryMaxMs, random))
      }
    }
    throw new Error('eventbus_publish_exhausted_without_attempt')
  }
  const publishDlqEvent = async (
    subject: (typeof eventBusOperationalSubjects)[number],
    event: MEventEnvelope
  ) => {
    try {
      await publishToJetStream(subject, event)
    } catch (error) {
      logger.error(
        {
          subject,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error)
        },
        'dlq_publish_failed'
      )
    }
  }
  const ensureStreams = async () => {
    try {
      await ensureStreamSubjects(jsm, streamNames)
      markReady()
    } catch (error) {
      markFailure(error instanceof Error ? error.message : 'eventbus_stream_setup_failed')
    }
  }
  await ensureStreams()
  return {
    async ensureStreams() {
      await ensureStreams()
    },
    async readiness() {
      try {
        await options.nc.flush()
      } catch (error) {
        markFailure(error instanceof Error ? error.message : 'nats_flush_failed')
      }
      return { ready: runtimeState.ready }
    },
    publishMetricsSummary() {
      return snapshotPublishMetrics(metricsState)
    },
    async reportRejected(input) {
      const identity = readEventIdentity(input.event)
      const at = isoNow()
      const event = createDlqEnvelope(
        'meventbus.publish.rejected',
        {
          failedSubject: input.subject,
          reason: input.reason,
          errors: input.errors,
          originalEvent: input.event,
          ...(identity.eventId ? { eventId: identity.eventId } : {}),
          ...(identity.source ? { source: identity.source, callerService: identity.source } : {}),
          ...(identity.actor ? { actor: identity.actor } : {}),
          ...(identity.eventType ? { eventType: identity.eventType } : {}),
          ...(identity.correlationId ? { correlationId: identity.correlationId } : {}),
          ...(identity.traceId ? { traceId: identity.traceId } : {}),
          ...(identity.causationId ? { causationId: identity.causationId } : {})
        } satisfies EventBusRejectedPayloadFromSchema,
        identity.correlationId,
        identity.traceId
      )
      await publishDlqEvent('meventbus.publish.rejected.v0', event)
      metricsState.lastRejected = {
        at,
        failedSubject: input.subject,
        reason: input.reason,
        errors: [...input.errors],
        ...(identity.source ? { callerService: identity.source } : {}),
        ...(identity.actor ? { actor: identity.actor } : {}),
        ...(identity.eventType ? { eventType: identity.eventType } : {}),
        ...(identity.correlationId ? { correlationId: identity.correlationId } : {}),
        ...(identity.traceId ? { traceId: identity.traceId } : {}),
        ...(identity.causationId ? { causationId: identity.causationId } : {})
      }
      applySubjectOutcome(metricsState, input.subject, 'rejected')
      recordPublishOutcome('rejected', {
        subject: input.subject,
        source: identity.source,
        reason: input.reason
      })
    },
    async publish(subject, event) {
      if (!allowedEventBusSubjectSet.has(subject))
        throw new EventBusPublishError('subject_not_allowed', `subject_not_allowed:${subject}`)
      if (event.subject !== undefined && event.subject !== subject)
        throw new EventBusPublishError(
          'subject_mismatch',
          `subject_mismatch:${subject}:${event.subject}`
        )
      try {
        const outcome = await publishToJetStream(subject, event)
        markReady()
        applySubjectOutcome(metricsState, subject, 'success', Math.max(0, outcome.attempts - 1))
        recordPublishOutcome('success', { subject, source: event.source })
        recordRetryAttempts(subject, event.source, outcome.attempts)
        return { eventId: event.id }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'jetstream_publish_failed'
        markFailure(errorMessage)
        const actor =
          typeof event.payload === 'object' && event.payload !== null
            ? readOptionalStringField(event.payload, 'actor')
            : undefined
        const attempts =
          typeof error === 'object' && error !== null && 'attempts' in error
            ? Number((error as { attempts?: unknown }).attempts ?? retries + 1)
            : retries + 1
        const at = isoNow()
        const failedEvent = createDlqEnvelope(
          'meventbus.publish.failed',
          {
            failedSubject: subject,
            eventId: event.id,
            source: event.source,
            callerService: event.source,
            ...(actor ? { actor } : {}),
            eventType: event.type,
            reason: 'publish_failed',
            attempts,
            errorMessage,
            originalEvent: event,
            retryBaseMs,
            retryMaxMs,
            timeoutMs: publishTimeoutMs,
            ...(event.correlationId ? { correlationId: event.correlationId } : {}),
            ...(event.traceId ? { traceId: event.traceId } : {}),
            ...(event.causationId ? { causationId: event.causationId } : {})
          } satisfies EventBusPublishFailedPayloadFromSchema,
          event.correlationId,
          event.traceId
        )
        await publishDlqEvent('meventbus.publish.failed.v0', failedEvent)
        metricsState.lastFailed = {
          at,
          failedSubject: subject,
          reason: 'publish_failed',
          attempts,
          errorMessage,
          ...(event.source ? { callerService: event.source } : {}),
          ...(actor ? { actor } : {}),
          eventType: event.type,
          ...(event.correlationId ? { correlationId: event.correlationId } : {}),
          ...(event.traceId ? { traceId: event.traceId } : {}),
          ...(event.causationId ? { causationId: event.causationId } : {})
        }
        applySubjectOutcome(metricsState, subject, 'failed', Math.max(0, attempts - 1))
        recordPublishOutcome('failed', { subject, source: event.source, reason: 'publish_failed' })
        recordRetryAttempts(subject, event.source, attempts)
        throw new EventBusPublishError('publish_failed', errorMessage)
      }
    }
  }
}
