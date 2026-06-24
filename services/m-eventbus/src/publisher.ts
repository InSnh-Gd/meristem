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
  documentedEventBusSubjects,
  eventBusOperationalSubjects
} from '../../../packages/events/src/subject-catalog.ts'
import { createLogger, recordCounter } from '../../../packages/telemetry/src/index.ts'

const logger = createLogger('m-eventbus')

const DEFAULT_EVENTS_STREAM = 'MERISTEM_EVENTS'
const DEFAULT_DLQ_STREAM = 'MERISTEM_EVENTBUS_DLQ'
const DEFAULT_PUBLISH_RETRIES = 2
const DEFAULT_PUBLISH_TIMEOUT_MS = 1000
const DEFAULT_RETRY_BASE_MS = 100
const DEFAULT_RETRY_MAX_MS = 2000

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

export type EventBusRuntimeState = {
  ready: boolean
  lastError?: string
}

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

type DlqEventKind = 'meventbus.publish.rejected' | 'meventbus.publish.failed'

type StreamNames = {
  events: string
  dlq: string
}

/**
 * EventBus 发布退避采用指数增长 + 正向抖动，避免 NATS 短暂抖动时所有调用方同步重试放大冲击。
 */
export function calculatePublishBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt))
  const cappedBase = Math.min(baseMs * 2 ** (normalizedAttempt - 1), maxMs)
  const clampedRandom = Math.min(Math.max(random(), 0), 1)
  const jitter = Math.floor(cappedBase * 0.2 * clampedRandom)
  return Math.min(cappedBase + jitter, maxMs)
}

async function ensureStreamSubjects(jsm: JetStreamManager, streamNames: StreamNames) {
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

async function ensureStream(
  jsm: JetStreamManager,
  input: { name: string; subjects: string[]; description: string }
) {
  try {
    const info = await jsm.streams.info(input.name)
    const currentSubjects = new Set(info.config.subjects ?? [])
    const nextSubjects = new Set(input.subjects)
    const subjectsChanged =
      currentSubjects.size !== nextSubjects.size ||
      input.subjects.some(subject => !currentSubjects.has(subject))

    if (subjectsChanged || info.config.description !== input.description) {
      await jsm.streams.update(input.name, {
        ...info.config,
        description: input.description,
        subjects: input.subjects
      })
    }
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

function createDlqEnvelope(
  kind: DlqEventKind,
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

function readOptionalStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
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

/**
 * 失败侧信号需要统一归因维度，避免 rejected/failed 两类 operational event 字段漂移。
 */
function readEventIdentity(event: unknown): EventIdentity {
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
function recordPublishOutcome(
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

function recordRetryAttempts(subject: string, source: string | undefined, attempts: number): void {
  if (attempts <= 1) return
  recordCounter('eventbus.publish.retry_attempts_total', attempts - 1, {
    subject,
    ...(source ? { source } : {}),
    outcome: 'retry'
  })
}

function isoNow(): string {
  return new Date().toISOString()
}

function ensureSubjectMetrics(
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

function applySubjectOutcome(
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

function snapshotPublishMetrics(
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
        if (attempt >= retries) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            attempts: attempt + 1
          })
        }

        const delayMs = calculatePublishBackoffMs(attempt + 1, retryBaseMs, retryMaxMs, random)
        await sleep(delayMs)
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
      if (!allowedEventBusSubjectSet.has(subject)) {
        throw new EventBusPublishError('subject_not_allowed', `subject_not_allowed:${subject}`)
      }

      if (event.subject !== undefined && event.subject !== subject) {
        throw new EventBusPublishError(
          'subject_mismatch',
          `subject_mismatch:${subject}:${event.subject}`
        )
      }

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
        recordPublishOutcome('failed', {
          subject,
          source: event.source,
          reason: 'publish_failed'
        })
        recordRetryAttempts(subject, event.source, attempts)
        throw new EventBusPublishError('publish_failed', errorMessage)
      }
    }
  }
}
