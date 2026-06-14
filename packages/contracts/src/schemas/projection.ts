import * as Schema from 'effect/Schema'

export const ProjectionCursorSchema = Schema.Struct({
  factId: Schema.NonEmptyString,
  timestamp: Schema.NonEmptyString
})
export type ProjectionCursorFromSchema = typeof ProjectionCursorSchema.Type

export const ProjectionStatusSchema = Schema.Literal('healthy', 'degraded', 'unavailable')
export type ProjectionStatusFromSchema = typeof ProjectionStatusSchema.Type

export const ProjectorJobStatusSchema = Schema.Literal(
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
)
export type ProjectorJobStatusFromSchema = typeof ProjectorJobStatusSchema.Type

// Projection control payloads are internal executable contracts; Elysia keeps TypeBox at the REST edge.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.1, §2.4
export const BackfillParamsSchema = Schema.Struct({
  index: Schema.NonEmptyString,
  from: Schema.NullOr(ProjectionCursorSchema),
  to: Schema.NullOr(ProjectionCursorSchema),
  batchSize: Schema.Number,
  targetVersion: Schema.optional(Schema.String)
})
export type BackfillParamsFromSchema = typeof BackfillParamsSchema.Type

export const ProjectionHealthSchema = Schema.Struct({
  index: Schema.String,
  lagSeconds: Schema.Number,
  lastProjectedAt: Schema.NullOr(Schema.String),
  pendingCount: Schema.Number,
  dlqCount: Schema.Number,
  status: ProjectionStatusSchema
})
export type ProjectionHealthFromSchema = typeof ProjectionHealthSchema.Type

export const ProjectionHealthResponseSchema = Schema.Struct({
  indices: Schema.Array(ProjectionHealthSchema)
})
export type ProjectionHealthResponseFromSchema = typeof ProjectionHealthResponseSchema.Type

export const BackfillResultSchema = Schema.Struct({
  jobId: Schema.String,
  processedCount: Schema.Number,
  errors: Schema.Number,
  lastCursor: Schema.NullOr(ProjectionCursorSchema),
  status: ProjectorJobStatusSchema
})
export type BackfillResultFromSchema = typeof BackfillResultSchema.Type

export const DLQRecordSchema = Schema.Struct({
  id: Schema.String,
  jobId: Schema.String,
  factId: Schema.String,
  index: Schema.String,
  error: Schema.String,
  attemptedAt: Schema.Array(Schema.String),
  retries: Schema.Number,
  createdAt: Schema.String
})
export type DLQRecordFromSchema = typeof DLQRecordSchema.Type

export const ProjectionDLQResponseSchema = Schema.Struct({
  records: Schema.Array(DLQRecordSchema)
})
export type ProjectionDLQResponseFromSchema = typeof ProjectionDLQResponseSchema.Type

export const ProjectionReplayResponseSchema = Schema.Struct({
  replayed: Schema.Boolean
})
export type ProjectionReplayResponseFromSchema = typeof ProjectionReplayResponseSchema.Type

export const ProjectionSkipResponseSchema = Schema.Struct({
  skipped: Schema.Boolean
})
export type ProjectionSkipResponseFromSchema = typeof ProjectionSkipResponseSchema.Type
