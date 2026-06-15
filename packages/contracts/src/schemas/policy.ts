import * as Schema from 'effect/Schema'
import { actorIds, permissions } from '../literals.ts'

// Permission literals are executable contracts so Core, M-Policy, and adapters cannot drift silently.
// Policy 契约 schema 边界见 `docs/security/SECURITY-MODEL.md` 和 M-Policy 服务文档。
export const PermissionSchema = Schema.Literal(...permissions)
export type PermissionFromSchema = typeof PermissionSchema.Type

// 审批状态和投票的 Effect Schema，用于 decode/encode 契约测试和 drift 检查。

export const ApprovalStatusSchema = Schema.Literal(
  'pending',
  'approved',
  'rejected',
  'expired',
  'canceled'
)
export type ApprovalStatusFromSchema = typeof ApprovalStatusSchema.Type

export const ApprovalVoteTypeSchema = Schema.Literal('approve', 'reject')
export type ApprovalVoteTypeFromSchema = typeof ApprovalVoteTypeSchema.Type

export const ApprovalOriginServiceSchema = Schema.Literal('m-task', 'm-net')
export type ApprovalOriginServiceFromSchema = typeof ApprovalOriginServiceSchema.Type

export const ApprovalOriginActionSchema = Schema.Literal(
  'task.submit',
  'task.cancel',
  'task.retry',
  'mnet.profile.enable'
)
export type ApprovalOriginActionFromSchema = typeof ApprovalOriginActionSchema.Type

export const RequiredActionSchema = Schema.Literal('manual_review', 'multi_approval')
export type RequiredActionFromSchema = typeof RequiredActionSchema.Type

export const PolicyDecisionResultSchema = Schema.Literal(
  'allow',
  'deny',
  'require_manual_review',
  'require_multi_approval'
)
export type PolicyDecisionResultFromSchema = typeof PolicyDecisionResultSchema.Type

export const PolicyApprovalSchema = Schema.Struct({
  id: Schema.String,
  policyDecisionId: Schema.String,
  originService: ApprovalOriginServiceSchema,
  operationId: Schema.String,
  requestedBy: Schema.Literal(...actorIds),
  requiredAction: RequiredActionSchema,
  status: ApprovalStatusSchema,
  quorumRequired: Schema.Number,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.optional(Schema.String)
})
export type PolicyApprovalFromSchema = typeof PolicyApprovalSchema.Type

export const PolicyApprovalVoteSchema = Schema.Struct({
  id: Schema.String,
  approvalId: Schema.String,
  actor: Schema.Literal(...actorIds),
  vote: ApprovalVoteTypeSchema,
  reason: Schema.optional(Schema.String),
  createdAt: Schema.String
})
export type PolicyApprovalVoteFromSchema = typeof PolicyApprovalVoteSchema.Type

export const ApprovalActionRequestSchema = Schema.Struct({
  reason: Schema.optional(Schema.String)
})
export type ApprovalActionRequestFromSchema = typeof ApprovalActionRequestSchema.Type

export const ApprovalCreateResponseSchema = Schema.Struct({
  approval: PolicyApprovalSchema
})
export type ApprovalCreateResponseFromSchema = typeof ApprovalCreateResponseSchema.Type

export const ApprovalListResponseSchema = Schema.Struct({
  approvals: Schema.Array(PolicyApprovalSchema)
})
export type ApprovalListResponseFromSchema = typeof ApprovalListResponseSchema.Type

export const ApprovalDetailResponseSchema = Schema.Struct({
  id: Schema.String,
  policyDecisionId: Schema.String,
  originService: ApprovalOriginServiceSchema,
  operationId: Schema.String,
  requestedBy: Schema.Literal(...actorIds),
  requiredAction: RequiredActionSchema,
  status: ApprovalStatusSchema,
  quorumRequired: Schema.Number,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  votes: Schema.Array(PolicyApprovalVoteSchema)
})
export type ApprovalDetailResponseFromSchema = typeof ApprovalDetailResponseSchema.Type

export const ApprovalActionResponseSchema = Schema.Struct({
  approval: PolicyApprovalSchema,
  votes: Schema.Array(PolicyApprovalVoteSchema)
})
export type ApprovalActionResponseFromSchema = typeof ApprovalActionResponseSchema.Type

export const SuspendedOperationStatusSchema = Schema.Literal(
  'suspended',
  'resumed',
  'rejected',
  'expired',
  'resume_failed'
)
export type SuspendedOperationStatusFromSchema = typeof SuspendedOperationStatusSchema.Type

export const TaskSuspendedOperationSchema = Schema.Struct({
  id: Schema.String,
  policyDecisionId: Schema.String,
  action: ApprovalOriginActionSchema,
  requestedBy: Schema.Literal(...actorIds),
  resource: Schema.String,
  sanitizedPayload: Schema.Unknown,
  correlationId: Schema.String,
  idempotencyKey: Schema.String,
  status: SuspendedOperationStatusSchema,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  resumedAt: Schema.optional(Schema.String),
  terminalReason: Schema.optional(Schema.String)
})
export type TaskSuspendedOperationFromSchema = typeof TaskSuspendedOperationSchema.Type

export const PolicyApprovalEventPayloadSchema = Schema.Struct({
  approvalId: Schema.String,
  policyDecisionId: Schema.String,
  originService: ApprovalOriginServiceSchema,
  operationId: Schema.String,
  requestedBy: Schema.Literal(...actorIds),
  requiredAction: RequiredActionSchema,
  status: ApprovalStatusSchema
})
export type PolicyApprovalEventPayloadFromSchema = typeof PolicyApprovalEventPayloadSchema.Type

export const PolicyDecisionCreatedPayloadSchema = Schema.Struct({
  decisionId: Schema.String,
  actor: Schema.Literal(...actorIds),
  action: PermissionSchema,
  resource: Schema.String,
  result: PolicyDecisionResultSchema,
  reasons: Schema.Array(Schema.String)
})
export type PolicyDecisionCreatedPayloadFromSchema = typeof PolicyDecisionCreatedPayloadSchema.Type
