import * as Schema from 'effect/Schema'

export const EventBusRejectedReasonSchema = Schema.Literal(
  'invalid_envelope',
  'subject_not_allowed',
  'subject_mismatch'
)
export type EventBusRejectedReasonFromSchema = typeof EventBusRejectedReasonSchema.Type

export const EventBusPublishFailureReasonSchema = Schema.Literal('publish_failed')
export type EventBusPublishFailureReasonFromSchema = typeof EventBusPublishFailureReasonSchema.Type

export const EventBusPublishOutcomeSchema = Schema.Literal('success', 'rejected', 'failed')
export type EventBusPublishOutcomeFromSchema = typeof EventBusPublishOutcomeSchema.Type

export const EventBusRejectedPayloadSchema = Schema.Struct({
  failedSubject: Schema.String,
  eventId: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  callerService: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
  eventType: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String),
  reason: EventBusRejectedReasonSchema,
  errors: Schema.Array(Schema.String),
  originalEvent: Schema.Unknown
})
export type EventBusRejectedPayloadFromSchema = typeof EventBusRejectedPayloadSchema.Type

export const EventBusPublishFailedPayloadSchema = Schema.Struct({
  failedSubject: Schema.String,
  eventId: Schema.String,
  source: Schema.String,
  callerService: Schema.String,
  actor: Schema.optional(Schema.String),
  eventType: Schema.String,
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String),
  reason: EventBusPublishFailureReasonSchema,
  attempts: Schema.Number,
  retryBaseMs: Schema.optional(Schema.Number),
  retryMaxMs: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  errorMessage: Schema.String,
  originalEvent: Schema.Unknown
})
export type EventBusPublishFailedPayloadFromSchema = typeof EventBusPublishFailedPayloadSchema.Type

export const EventBusPublishTotalsSchema = Schema.Struct({
  success: Schema.Number,
  rejected: Schema.Number,
  failed: Schema.Number,
  retryAttempts: Schema.Number
})
export type EventBusPublishTotalsFromSchema = typeof EventBusPublishTotalsSchema.Type

export const EventBusPublishSubjectMetricsSchema = Schema.Struct({
  subject: Schema.String,
  success: Schema.Number,
  rejected: Schema.Number,
  failed: Schema.Number,
  retryAttempts: Schema.Number,
  lastOutcome: Schema.optional(EventBusPublishOutcomeSchema),
  lastOutcomeAt: Schema.optional(Schema.String)
})
export type EventBusPublishSubjectMetricsFromSchema =
  typeof EventBusPublishSubjectMetricsSchema.Type

export const EventBusLastRejectedSnapshotSchema = Schema.Struct({
  at: Schema.String,
  failedSubject: Schema.String,
  reason: EventBusRejectedReasonSchema,
  errors: Schema.Array(Schema.String),
  callerService: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
  eventType: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String)
})
export type EventBusLastRejectedSnapshotFromSchema = typeof EventBusLastRejectedSnapshotSchema.Type

export const EventBusLastFailedSnapshotSchema = Schema.Struct({
  at: Schema.String,
  failedSubject: Schema.String,
  reason: EventBusPublishFailureReasonSchema,
  attempts: Schema.Number,
  errorMessage: Schema.String,
  callerService: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
  eventType: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String)
})
export type EventBusLastFailedSnapshotFromSchema = typeof EventBusLastFailedSnapshotSchema.Type

export const EventBusPublishMetricsSummarySchema = Schema.Struct({
  service: Schema.Literal('m-eventbus'),
  generatedAt: Schema.String,
  windowStartedAt: Schema.String,
  totals: EventBusPublishTotalsSchema,
  subjects: Schema.Array(EventBusPublishSubjectMetricsSchema),
  lastRejected: Schema.optional(EventBusLastRejectedSnapshotSchema),
  lastFailed: Schema.optional(EventBusLastFailedSnapshotSchema)
})
export type EventBusPublishMetricsSummaryFromSchema =
  typeof EventBusPublishMetricsSummarySchema.Type
