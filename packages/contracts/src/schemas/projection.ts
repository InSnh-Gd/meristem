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
// Projection 契约 schema 边界见 `docs/services/m-log.md`、`docs/data/STATE-MODEL.md` 和契约版本规则。
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

// Projection staleness and source metadata mark every read-model row as non-authoritative.
// PostgreSQL tables and audit logs remain the only authoritative state.
// 投影 sourceType 和 staleness 元数据保证每个读模型行都被标记为非权威。
export const ProjectionSourceTypeSchema = Schema.Literal(
  'nats_event',
  'postgres_cdc',
  'rest_api',
  'backfill'
)
export type ProjectionSourceTypeFromSchema = typeof ProjectionSourceTypeSchema.Type

export const ProjectionStalenessSchema = Schema.Struct({
  sourceType: ProjectionSourceTypeSchema,
  authoritative: Schema.Literal(false),
  projectedAt: Schema.String,
  sourceEventId: Schema.optional(Schema.String),
  lagMs: Schema.optional(Schema.Number)
})
export type ProjectionStalenessFromSchema = typeof ProjectionStalenessSchema.Type

// Approval profile UI projections present a read-optimized view of network/profile
// state without any write coupling to PostgreSQL state changes.
export const ApprovalProfileProjectionSchema = Schema.Struct({
  networkId: Schema.String,
  profileVersion: Schema.String,
  status: Schema.Literal('enabled', 'disabled'),
  updatedAt: Schema.String,
  staleness: ProjectionStalenessSchema
})
export type ApprovalProfileProjectionFromSchema = typeof ApprovalProfileProjectionSchema.Type

// Behavior-analysis projections capture vote-level decisions for trend/usage
// visibility without coupling to approval lifecycle state machines.
export const BehaviorAnalysisProjectionSchema = Schema.Struct({
  approvalId: Schema.String,
  actor: Schema.String,
  action: Schema.Literal('approve', 'reject'),
  decision: Schema.Literal('vote_recorded', 'approved', 'rejected'),
  timestamp: Schema.String,
  staleness: ProjectionStalenessSchema
})
export type BehaviorAnalysisProjectionFromSchema = typeof BehaviorAnalysisProjectionSchema.Type
