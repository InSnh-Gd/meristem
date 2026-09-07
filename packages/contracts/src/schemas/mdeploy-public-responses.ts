import * as Schema from 'effect/Schema'
import {
  MDeployApprovalV01Schema,
  MDeployApplyStatusSchema,
  MDeployEvidenceMetadataV01Schema,
  MDeployProposalV01Schema,
  MDeployPublicationStatusSchema
} from './mdeploy-operations.ts'
import { MDeployDigestSchema } from './mdeploy-common.ts'
import {
  MDeployAgentEnrollmentV01Schema,
  MDeployAgentHeartbeatV01Schema,
  MDeployDriftReportV01Schema
} from './mdeploy-agent.ts'

/**
 * M-Deploy 公开路由响应信封（Core facade / M-CLI 解码边界共用的权威契约）。
 * M-Deploy 拥有这些形状；此处只声明"公开响应如何被消费者解码"，不与 M-Deploy 内部事实结构重复实现。
 */

export const MDeployOperationKindSchema = Schema.Literals(['apply', 'rollback'])
export const MDeployOperationStatusSchema = Schema.Literals([
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked'
])

export const MDeployOperationV01Schema = Schema.Struct({
  operationId: Schema.String,
  kind: MDeployOperationKindSchema,
  proposalId: Schema.optional(Schema.String),
  agentId: Schema.String,
  envelope: Schema.Unknown,
  desiredStateDigest: MDeployDigestSchema,
  actor: Schema.String,
  policyDecisionId: Schema.String,
  quorumProofId: Schema.optional(Schema.String),
  auditId: Schema.String,
  correlationId: Schema.String,
  status: MDeployOperationStatusSchema,
  publicationStatus: MDeployPublicationStatusSchema,
  createdAt: Schema.String,
  previousDigest: Schema.optional(MDeployDigestSchema),
  completedAt: Schema.optional(Schema.String)
})
export type MDeployOperationV01FromSchema = typeof MDeployOperationV01Schema.Type

export const MDeployDesiredStateSummaryV01Schema = Schema.Struct({
  latestDigest: Schema.optional(MDeployDigestSchema),
  lastSuccessfulDigest: Schema.optional(MDeployDigestSchema),
  syncedAt: Schema.optional(Schema.String),
  stale: Schema.Boolean,
  controllerAvailable: Schema.Boolean
})
export type MDeployDesiredStateSummaryV01FromSchema =
  typeof MDeployDesiredStateSummaryV01Schema.Type

export const MDeployAgentRecordV01Schema = Schema.Struct({
  enrollment: MDeployAgentEnrollmentV01Schema,
  heartbeat: Schema.optional(MDeployAgentHeartbeatV01Schema)
})
export type MDeployAgentRecordV01FromSchema = typeof MDeployAgentRecordV01Schema.Type

export const MDeployProposalResponseSchema = Schema.Struct({
  proposal: MDeployProposalV01Schema
})
export type MDeployProposalResponseFromSchema = typeof MDeployProposalResponseSchema.Type

export const MDeployApprovalResponseSchema = Schema.Struct({
  approval: MDeployApprovalV01Schema
})
export type MDeployApprovalResponseFromSchema = typeof MDeployApprovalResponseSchema.Type

export const MDeployApplyOperationResponseSchema = Schema.Struct({
  operation: MDeployOperationV01Schema.pipe(
    Schema.fieldsAssign({ applyStatus: MDeployApplyStatusSchema })
  )
})
export type MDeployApplyOperationResponseFromSchema =
  typeof MDeployApplyOperationResponseSchema.Type

export const MDeployRollbackOperationResponseSchema = Schema.Struct({
  operation: MDeployOperationV01Schema
})
export type MDeployRollbackOperationResponseFromSchema =
  typeof MDeployRollbackOperationResponseSchema.Type

export const MDeployDriftResponseSchema = Schema.Struct({
  reports: Schema.Array(MDeployDriftReportV01Schema)
})
export type MDeployDriftResponseFromSchema = typeof MDeployDriftResponseSchema.Type

export const MDeployDriftCheckResponseSchema = Schema.Struct({
  requested: Schema.Literal(true),
  correlationId: Schema.String
})
export type MDeployDriftCheckResponseFromSchema = typeof MDeployDriftCheckResponseSchema.Type

export const MDeployEvidenceResponseSchema = Schema.Struct({
  evidence: Schema.Array(MDeployEvidenceMetadataV01Schema)
})
export type MDeployEvidenceResponseFromSchema = typeof MDeployEvidenceResponseSchema.Type

export const MDeployAgentsResponseSchema = Schema.Struct({
  agents: Schema.Array(MDeployAgentRecordV01Schema)
})
export type MDeployAgentsResponseFromSchema = typeof MDeployAgentsResponseSchema.Type
