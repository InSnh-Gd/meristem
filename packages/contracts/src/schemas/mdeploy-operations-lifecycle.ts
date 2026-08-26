import * as Schema from 'effect/Schema'
import { MDeployDigestSchema } from './mdeploy-common.ts'
import {
  MDeployEvidenceTypeSchema,
  MDeployImageArtifactV01Schema,
  MDeployStorageRefV01Schema
} from './mdeploy-operations-artifacts.ts'
import {
  MDeployApprovalV01Schema,
  MDeployProposalV01Schema
} from './mdeploy-operations-approval-runtime.ts'

export const MDeployRollbackPointerV01Schema = Schema.Struct({
  environment: Schema.String,
  digest: MDeployDigestSchema,
  promotionId: Schema.optional(Schema.String)
})
export type MDeployRollbackPointerV01FromSchema = typeof MDeployRollbackPointerV01Schema.Type

export const MDeployPromotionV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.promotion@0.1.0'),
  promotionId: Schema.String,
  sourceEnvironment: Schema.String,
  targetEnvironment: Schema.String,
  artifact: MDeployImageArtifactV01Schema,
  approvalActor: Schema.String,
  rollbackPointer: MDeployRollbackPointerV01Schema,
  promotedAt: Schema.String,
  correlationId: Schema.String
})
export type MDeployPromotionV01FromSchema = typeof MDeployPromotionV01Schema.Type

export const MDeployEvidenceMetadataV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.evidence-metadata@0.1.0'),
  operationId: Schema.String,
  correlationId: Schema.String,
  auditId: Schema.String,
  evidenceType: MDeployEvidenceTypeSchema,
  timestamp: Schema.String,
  storageRef: MDeployStorageRefV01Schema
})
export type MDeployEvidenceMetadataV01FromSchema = typeof MDeployEvidenceMetadataV01Schema.Type

export const MDeployApplyStatusSchema = Schema.Literal(
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked'
)
export type MDeployApplyStatusFromSchema = typeof MDeployApplyStatusSchema.Type

export const MDeployPublicationStatusSchema = Schema.Literal('pending', 'published')
export type MDeployPublicationStatusFromSchema = typeof MDeployPublicationStatusSchema.Type

export const MDeployReconcileResultV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.reconcile-result@0.1.0'),
  operationId: Schema.String,
  agentId: Schema.String,
  desiredStateDigest: MDeployDigestSchema,
  applyStatus: MDeployApplyStatusSchema,
  publicationStatus: MDeployPublicationStatusSchema,
  evidenceRefs: Schema.Array(MDeployStorageRefV01Schema),
  completedAt: Schema.optional(Schema.String)
})
export type MDeployReconcileResultV01FromSchema = typeof MDeployReconcileResultV01Schema.Type

export const MDeployRollbackRequestV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.rollback-request@0.1.0'),
  operationId: Schema.String,
  targetDigest: MDeployDigestSchema,
  actor: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  requestedAt: Schema.String
})
export type MDeployRollbackRequestV01FromSchema = typeof MDeployRollbackRequestV01Schema.Type

export const MDeployRollbackStatusSchema = Schema.Literal(
  'running',
  'succeeded',
  'failed',
  'blocked'
)
export type MDeployRollbackStatusFromSchema = typeof MDeployRollbackStatusSchema.Type

export const MDeployRollbackResultV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.rollback-result@0.1.0'),
  operationId: Schema.String,
  previousDigest: MDeployDigestSchema,
  restoredDigest: MDeployDigestSchema,
  status: MDeployRollbackStatusSchema,
  publicationStatus: MDeployPublicationStatusSchema,
  evidenceRefs: Schema.Array(MDeployStorageRefV01Schema),
  completedAt: Schema.optional(Schema.String)
})
export type MDeployRollbackResultV01FromSchema = typeof MDeployRollbackResultV01Schema.Type

export const MDeployProposalCreatedPayloadSchema = MDeployProposalV01Schema
export type MDeployProposalCreatedPayloadFromSchema =
  typeof MDeployProposalCreatedPayloadSchema.Type

export const MDeployApprovalRecordedPayloadSchema = MDeployApprovalV01Schema
export type MDeployApprovalRecordedPayloadFromSchema =
  typeof MDeployApprovalRecordedPayloadSchema.Type

export const MDeployApplyStartedPayloadSchema = MDeployReconcileResultV01Schema
export type MDeployApplyStartedPayloadFromSchema = typeof MDeployApplyStartedPayloadSchema.Type

export const MDeployApplySucceededPayloadSchema = MDeployReconcileResultV01Schema
export type MDeployApplySucceededPayloadFromSchema = typeof MDeployApplySucceededPayloadSchema.Type

export const MDeployApplyFailedPayloadSchema = MDeployReconcileResultV01Schema
export type MDeployApplyFailedPayloadFromSchema = typeof MDeployApplyFailedPayloadSchema.Type

export const MDeployRollbackStartedPayloadSchema = MDeployRollbackResultV01Schema
export type MDeployRollbackStartedPayloadFromSchema =
  typeof MDeployRollbackStartedPayloadSchema.Type

export const MDeployRollbackSucceededPayloadSchema = MDeployRollbackResultV01Schema
export type MDeployRollbackSucceededPayloadFromSchema =
  typeof MDeployRollbackSucceededPayloadSchema.Type

export const MDeployRollbackFailedPayloadSchema = MDeployRollbackResultV01Schema
export type MDeployRollbackFailedPayloadFromSchema = typeof MDeployRollbackFailedPayloadSchema.Type

export const MDeployEvidenceEmittedPayloadSchema = MDeployEvidenceMetadataV01Schema
export type MDeployEvidenceEmittedPayloadFromSchema =
  typeof MDeployEvidenceEmittedPayloadSchema.Type
