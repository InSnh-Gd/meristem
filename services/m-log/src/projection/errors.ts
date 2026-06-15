import * as Schema from 'effect/Schema'

// Projection workflow errors are typed so Core/internal adapters can preserve failure meaning.
// 投影错误模型用于稳定失败分类，边界见 `docs/services/m-log.md`。
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
