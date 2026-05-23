import * as Schema from 'effect/Schema'

// Projection workflow errors are typed so Core/internal adapters can preserve failure meaning.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §3 Slice 2
export class ProjectionUnknownIndexError extends Schema.TaggedError<ProjectionUnknownIndexError>()(
  'ProjectionUnknownIndexError',
  {
    index: Schema.String,
    message: Schema.String
  }
) {}

export class ProjectionWorkflowError extends Schema.TaggedError<ProjectionWorkflowError>()(
  'ProjectionWorkflowError',
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export type ProjectionError = ProjectionUnknownIndexError | ProjectionWorkflowError

