import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import {
  ApprovalOriginServiceSchema,
  ApprovalStatusSchema,
  RequiredActionSchema
} from './policy.ts'

/**
 * DFW-001: Internal-only bounded/redacted approval context contract for
 * future LLM-assisted approval review. No LLM provider calls or user-visible
 * summaries. Full Log records only redacted context-build metadata.
 *
 * Permission: internal context build requires `policy:read` and visibility
 * over `policy.approval:{approvalId}`.
 */

// ── Redacted source reference (never contains raw values) ─────────────

export const ApprovalContextSourceSchema = Schema.Literal(
  'approval',
  'policy-decision',
  'vote',
  'operation',
  'log-summary',
  'task-reference'
)
export type ApprovalContextSourceFromSchema = typeof ApprovalContextSourceSchema.Type

// ── Bounded vote entry (no raw actor token, no unbounded reason) ──────

export const ApprovalContextVoteEntrySchema = Schema.Struct({
  actor: Schema.Literal(...actorIds),
  vote: Schema.Literal('approve', 'reject'),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
  createdAt: Schema.String
})
export type ApprovalContextVoteEntryFromSchema = typeof ApprovalContextVoteEntrySchema.Type

// ── Bounded approval entry (subset of PolicyApprovalSchema fields) ────

export const ApprovalContextApprovalEntrySchema = Schema.Struct({
  id: Schema.String,
  status: ApprovalStatusSchema,
  originService: ApprovalOriginServiceSchema,
  operationId: Schema.String,
  requestedBy: Schema.Literal(...actorIds),
  requiredAction: RequiredActionSchema,
  quorumRequired: Schema.Number,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  completedAt: Schema.optional(Schema.String)
})
export type ApprovalContextApprovalEntryFromSchema = typeof ApprovalContextApprovalEntrySchema.Type

// ── Bounded policy decision reference (action/resource only) ──────────

export const ApprovalContextDecisionRefSchema = Schema.Struct({
  decisionId: Schema.String,
  action: Schema.String.pipe(Schema.maxLength(64)),
  resource: Schema.String.pipe(Schema.maxLength(256)),
  result: Schema.Literal('allow', 'deny', 'require_manual_review', 'require_multi_approval'),
  reasons: Schema.Array(Schema.String.pipe(Schema.maxLength(200)))
})
export type ApprovalContextDecisionRefFromSchema = typeof ApprovalContextDecisionRefSchema.Type

// ── Bounded operation reference ────────────────────────────────────────

export const ApprovalContextOperationRefSchema = Schema.Struct({
  operationId: Schema.String,
  action: Schema.String.pipe(Schema.maxLength(64)),
  status: Schema.Literal('suspended', 'resumed', 'rejected', 'expired', 'resume_failed')
})
export type ApprovalContextOperationRefFromSchema = typeof ApprovalContextOperationRefSchema.Type

// ── Redacted log summary reference ─────────────────────────────────────

export const ApprovalContextLogRefSchema = Schema.Struct({
  source: Schema.Literal('timeline', 'full-log'),
  lineCount: Schema.Number,
  truncated: Schema.Boolean
})
export type ApprovalContextLogRefFromSchema = typeof ApprovalContextLogRefSchema.Type

// ── Redacted build metadata for Full Log ───────────────────────────────

export const ApprovalContextBuildMetaSchema = Schema.Struct({
  approvalId: Schema.String,
  fieldCount: Schema.Number,
  redactionCount: Schema.Number,
  sourceList: Schema.Array(ApprovalContextSourceSchema),
  correlationId: Schema.String
})
export type ApprovalContextBuildMetaFromSchema = typeof ApprovalContextBuildMetaSchema.Type

// ── Complete bounded context (no raw secrets, no tokens, no log bodies)

export const ApprovalContextSchema = Schema.Struct({
  approval: ApprovalContextApprovalEntrySchema,
  votes: Schema.Array(ApprovalContextVoteEntrySchema),
  policyDecision: ApprovalContextDecisionRefSchema,
  relatedOperations: Schema.Array(ApprovalContextOperationRefSchema),
  logs: Schema.Array(ApprovalContextLogRefSchema)
})
export type ApprovalContextFromSchema = typeof ApprovalContextSchema.Type

// ── Error types ────────────────────────────────────────────────────────

export const ApprovalContextErrorCodeSchema = Schema.Literal(
  'approval_context.not_found',
  'approval_context.source_unavailable',
  'approval_context.redaction_failed',
  'approval_context.forbidden'
)
export type ApprovalContextErrorCodeFromSchema = typeof ApprovalContextErrorCodeSchema.Type

export const ApprovalContextErrorSchema = Schema.Struct({
  code: ApprovalContextErrorCodeSchema,
  message: Schema.String,
  correlationId: Schema.optional(Schema.String)
})
export type ApprovalContextErrorFromSchema = typeof ApprovalContextErrorSchema.Type
