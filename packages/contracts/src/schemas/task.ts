import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import { ApiErrorSchema, OperationDangerLevelSchema, RiskFactorSchema } from './core.ts'

export const TaskTypeSchema = Schema.Literal('noop')
export type TaskTypeFromSchema = typeof TaskTypeSchema.Type

export const MTaskStatusSchema = Schema.Literal(
  'accepted',
  'queued',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancel_requested',
  'canceled',
  'timed_out'
)
export type MTaskStatusFromSchema = typeof MTaskStatusSchema.Type

export const TaskRiskSummarySchema = Schema.Struct({
  operationDangerLevel: OperationDangerLevelSchema,
  suspicionScore: Schema.Number,
  riskFactors: Schema.Array(RiskFactorSchema)
})
export type TaskRiskSummaryFromSchema = typeof TaskRiskSummarySchema.Type

export const TaskPolicyResultSchema = Schema.Literal(
  'allow',
  'deny',
  'require_manual_review',
  'require_multi_approval'
)
export type TaskPolicyResultFromSchema = typeof TaskPolicyResultSchema.Type

export const MTaskPolicyDecisionSchema = Schema.Struct({
  decisionId: Schema.String,
  result: TaskPolicyResultSchema,
  requiredAction: Schema.optional(Schema.Literal('manual_review', 'multi_approval')),
  reasons: Schema.Array(Schema.String)
})
export type MTaskPolicyDecisionFromSchema = typeof MTaskPolicyDecisionSchema.Type

export const MTaskSchema = Schema.Struct({
  id: Schema.String,
  nodeId: Schema.String,
  leafNodeId: Schema.String,
  type: TaskTypeSchema,
  status: MTaskStatusSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  timeoutAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
  canceledAt: Schema.optional(Schema.String)
})
export type MTaskFromSchema = typeof MTaskSchema.Type

export const TaskDefinitionsResponseSchema = Schema.Struct({
  taskDefinitions: Schema.Array(
    Schema.Struct({
      type: TaskTypeSchema,
      version: Schema.String,
      timeoutSeconds: Schema.Number
    })
  )
})
export type TaskDefinitionsResponseFromSchema = typeof TaskDefinitionsResponseSchema.Type

export const TaskListResponseSchema = Schema.Struct({
  tasks: Schema.Array(MTaskSchema)
})
export type TaskListResponseFromSchema = typeof TaskListResponseSchema.Type

export const SubmitTaskResponseSchema = Schema.Struct({
  task: MTaskSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  risk: TaskRiskSummarySchema
})
export type SubmitTaskResponseFromSchema = typeof SubmitTaskResponseSchema.Type

export const TaskStatusResponseSchema = Schema.Struct({
  task: MTaskSchema
})
export type TaskStatusResponseFromSchema = typeof TaskStatusResponseSchema.Type

export const TaskControlResponseSchema = Schema.Struct({
  task: MTaskSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  risk: TaskRiskSummarySchema
})
export type TaskControlResponseFromSchema = typeof TaskControlResponseSchema.Type

export const TaskRetryNotImplementedResponseSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Literal('not_implemented_yet'),
    message: Schema.String
  }),
  decisionId: Schema.String,
  risk: TaskRiskSummarySchema
})
export type TaskRetryNotImplementedResponseFromSchema =
  typeof TaskRetryNotImplementedResponseSchema.Type

export const NodeAgentTaskExecuteResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  taskId: Schema.String,
  result: Schema.Literal('completed'),
  completedAt: Schema.String
})
export type NodeAgentTaskExecuteResponseFromSchema = typeof NodeAgentTaskExecuteResponseSchema.Type

export const NodeAgentTaskExecuteEnvelopeResponseSchema = Schema.Struct({
  result: NodeAgentTaskExecuteResponseSchema
})
export type NodeAgentTaskExecuteEnvelopeResponseFromSchema =
  typeof NodeAgentTaskExecuteEnvelopeResponseSchema.Type

export const InternalTaskOperationResumeResponseSchema = Schema.Struct({
  resumed: Schema.Boolean,
  suspendedOpId: Schema.String,
  task: Schema.NullOr(MTaskSchema)
})
export type InternalTaskOperationResumeResponseFromSchema =
  typeof InternalTaskOperationResumeResponseSchema.Type

export const InternalTaskOperationRejectResponseSchema = Schema.Struct({
  rejected: Schema.Boolean,
  suspendedOpId: Schema.String
})
export type InternalTaskOperationRejectResponseFromSchema =
  typeof InternalTaskOperationRejectResponseSchema.Type

export const TaskLifecycleEventPayloadSchema = Schema.Struct({
  taskId: Schema.String,
  nodeId: Schema.String,
  type: TaskTypeSchema,
  status: MTaskStatusSchema
})
export type TaskLifecycleEventPayloadFromSchema = typeof TaskLifecycleEventPayloadSchema.Type

export const TaskOperationSuspendedPayloadSchema = Schema.Struct({
  decisionId: Schema.String,
  action: Schema.String,
  resource: Schema.String,
  actor: Schema.Literal(...actorIds)
})
export type TaskOperationSuspendedPayloadFromSchema =
  typeof TaskOperationSuspendedPayloadSchema.Type

export const TaskOperationResumedPayloadSchema = Schema.Struct({
  opId: Schema.String,
  action: Schema.String,
  resource: Schema.String,
  taskId: Schema.optional(Schema.String)
})
export type TaskOperationResumedPayloadFromSchema = typeof TaskOperationResumedPayloadSchema.Type

export const TaskOperationResumeFailurePayloadSchema = Schema.Struct({
  opId: Schema.String,
  reason: Schema.String,
  taskStatus: Schema.optional(MTaskStatusSchema)
})
export type TaskOperationResumeFailurePayloadFromSchema =
  typeof TaskOperationResumeFailurePayloadSchema.Type

export const TaskOperationRejectedPayloadSchema = Schema.Struct({
  opId: Schema.String,
  action: Schema.String,
  resource: Schema.String
})
export type TaskOperationRejectedPayloadFromSchema = typeof TaskOperationRejectedPayloadSchema.Type

export { ApiErrorSchema }
