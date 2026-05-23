import * as Schema from 'effect/Schema'

export const ProjectionCursorSchema = Schema.Struct({
  factId: Schema.NonEmptyString,
  timestamp: Schema.NonEmptyString
})

export const ProjectionStatusSchema = Schema.Literal('healthy', 'degraded', 'unavailable')

export const ProjectorJobStatusSchema = Schema.Literal('pending', 'running', 'completed', 'failed', 'cancelled')

// Projection control payloads are internal executable contracts; Elysia keeps TypeBox at the REST edge.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.1, §2.4
export const BackfillParamsSchema = Schema.Struct({
  index: Schema.NonEmptyString,
  from: Schema.NullOr(ProjectionCursorSchema),
  to: Schema.NullOr(ProjectionCursorSchema),
  batchSize: Schema.Number,
  targetVersion: Schema.optional(Schema.String)
})

