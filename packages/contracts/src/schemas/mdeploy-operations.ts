import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import {
  type MDeployDigestFromSchema,
  MDeployDigestSchema,
  MDeployGitSourceRefV01Schema,
  MDeployIacDriverSchema
} from './mdeploy-common.ts'

export const MDeployApprovalStatusSchema = Schema.Literal(
  'pending',
  'approved',
  'rejected',
  'expired'
)
export type MDeployApprovalStatusFromSchema = typeof MDeployApprovalStatusSchema.Type

export const MDeployApprovalResultSchema = Schema.Literal('approve', 'reject')
export type MDeployApprovalResultFromSchema = typeof MDeployApprovalResultSchema.Type

export const MDeployDiffSummaryV01Schema = Schema.Struct({
  added: Schema.Number,
  changed: Schema.Number,
  removed: Schema.Number,
  summary: Schema.String
})
export type MDeployDiffSummaryV01FromSchema = typeof MDeployDiffSummaryV01Schema.Type

export const MDeployProposalV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.proposal@0.1.0'),
  proposalId: Schema.String,
  sourceRef: MDeployGitSourceRefV01Schema,
  diffSummary: MDeployDiffSummaryV01Schema,
  actor: Schema.String,
  policyDecisionId: Schema.String,
  approvalStatus: MDeployApprovalStatusSchema,
  createdAt: Schema.String,
  correlationId: Schema.String
})
export type MDeployProposalV01FromSchema = typeof MDeployProposalV01Schema.Type

export const MDeployApprovalV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.approval@0.1.0'),
  approvalId: Schema.String,
  proposalId: Schema.String,
  approver: Schema.String,
  timestamp: Schema.String,
  result: MDeployApprovalResultSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type MDeployApprovalV01FromSchema = typeof MDeployApprovalV01Schema.Type

export const MDeployRuntimeClassSchema = Schema.Literal('production', 'compatibility')
export type MDeployRuntimeClassFromSchema = typeof MDeployRuntimeClassSchema.Type

export const MDeployRuntimeUnitManagerSchema = Schema.Literal('quadlet-systemd', 'docker-compose')
export type MDeployRuntimeUnitManagerFromSchema = typeof MDeployRuntimeUnitManagerSchema.Type

export const MDeployPodmanRuntimeDriverSelectionV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.runtime-driver-selection@0.1.0'),
  runtimeClass: Schema.Literal('production'),
  runtimeDriver: Schema.Literal('podman'),
  unitManager: Schema.Literal('quadlet-systemd'),
  iacDriver: MDeployIacDriverSchema,
  selectedAt: Schema.String,
  selectedBy: Schema.String
})
export type MDeployPodmanRuntimeDriverSelectionV01FromSchema =
  typeof MDeployPodmanRuntimeDriverSelectionV01Schema.Type

export const MDeployDockerRuntimeDriverSelectionV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.runtime-driver-selection@0.1.0'),
  runtimeClass: Schema.Literal('compatibility'),
  runtimeDriver: Schema.Literal('docker'),
  unitManager: Schema.Literal('docker-compose'),
  iacDriver: MDeployIacDriverSchema,
  selectedAt: Schema.String,
  selectedBy: Schema.String
})
export type MDeployDockerRuntimeDriverSelectionV01FromSchema =
  typeof MDeployDockerRuntimeDriverSelectionV01Schema.Type

export const MDeployRuntimeDriverSelectionV01Schema = Schema.Union(
  MDeployPodmanRuntimeDriverSelectionV01Schema,
  MDeployDockerRuntimeDriverSelectionV01Schema
)
export type MDeployRuntimeDriverSelectionV01FromSchema =
  typeof MDeployRuntimeDriverSelectionV01Schema.Type

export const MDeployRuntimeConfigurationValidationFailureSchema = Schema.Struct({
  code: Schema.Literal('runtime_configuration_invalid'),
  message: Schema.String
})
export type MDeployRuntimeConfigurationValidationFailureFromSchema =
  typeof MDeployRuntimeConfigurationValidationFailureSchema.Type

/**
 * 运行时选择只接受生产 Podman Quadlet/systemd 或 Docker Compose 兼容模式，禁止混合声明。
 */
export function validateMDeployRuntimeDriverSelectionV01(
  input: unknown
): Result<
  MDeployRuntimeDriverSelectionV01FromSchema,
  MDeployRuntimeConfigurationValidationFailureFromSchema
> {
  try {
    return ok(Schema.decodeUnknownSync(MDeployRuntimeDriverSelectionV01Schema)(input))
  } catch (error) {
    return err({ code: 'runtime_configuration_invalid', message: errorMessage(error) })
  }
}

export const MDeployOpenTofuStatusSchema = Schema.Literal(
  'not_started',
  'planning',
  'planned',
  'applying',
  'succeeded',
  'failed',
  'skipped'
)
export type MDeployOpenTofuStatusFromSchema = typeof MDeployOpenTofuStatusSchema.Type

export const MDeployOpenTofuPlanApplyStatusV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.opentofu-status@0.1.0'),
  operationId: Schema.String,
  planStatus: MDeployOpenTofuStatusSchema,
  applyStatus: MDeployOpenTofuStatusSchema,
  stateDigest: Schema.optional(MDeployDigestSchema),
  checkedAt: Schema.String,
  errorCode: Schema.optional(Schema.String)
})
export type MDeployOpenTofuPlanApplyStatusV01FromSchema =
  typeof MDeployOpenTofuPlanApplyStatusV01Schema.Type

export const MDeployEvidenceTypeSchema = Schema.Literal(
  'signature_verification',
  'runtime_plan',
  'runtime_apply',
  'opentofu_plan',
  'opentofu_apply',
  'agent_ack',
  'drift_report',
  'rollback'
)
export type MDeployEvidenceTypeFromSchema = typeof MDeployEvidenceTypeSchema.Type

export const MDeployStorageRefV01Schema = Schema.Struct({
  uri: Schema.String,
  digest: MDeployDigestSchema,
  redactionStatus: Schema.Literal('redacted', 'metadata_only')
})
export type MDeployStorageRefV01FromSchema = typeof MDeployStorageRefV01Schema.Type

export const MDeployOciReferrerArtifactSchema = Schema.Literal('signature', 'attestation')
export type MDeployOciReferrerArtifactFromSchema = typeof MDeployOciReferrerArtifactSchema.Type

export const MDeployOciReferrerVerificationV01Schema = Schema.Struct({
  tool: Schema.Literal('cosign'),
  operation: Schema.Literal('download-signature', 'download-attestation')
})
export type MDeployOciReferrerVerificationV01FromSchema =
  typeof MDeployOciReferrerVerificationV01Schema.Type

/** OCI referrer references retain the subject and retrieval operation so consumers can re-verify durable registry evidence. */
export const MDeployOciReferrerReferenceV01Schema = Schema.Struct({
  uri: Schema.String,
  digest: MDeployDigestSchema,
  redactionStatus: Schema.Literal('redacted', 'metadata_only'),
  subjectDigest: MDeployDigestSchema,
  artifact: MDeployOciReferrerArtifactSchema,
  predicateType: Schema.optional(Schema.String),
  verification: MDeployOciReferrerVerificationV01Schema
}).pipe(
  Schema.filter(reference => {
    const isSignature =
      reference.artifact === 'signature' &&
      reference.verification.operation === 'download-signature' &&
      reference.predicateType === undefined
    const isAttestation =
      reference.artifact === 'attestation' &&
      reference.verification.operation === 'download-attestation' &&
      typeof reference.predicateType === 'string' &&
      reference.predicateType.length > 0
    return isSignature || isAttestation
  }, {
    message: () => 'OCI referrer artifact and Cosign retrieval operation must agree'
  })
)
export type MDeployOciReferrerReferenceV01FromSchema =
  typeof MDeployOciReferrerReferenceV01Schema.Type

export const MDeployArtifactEvidenceReferenceV01Schema = Schema.Union(
  MDeployOciReferrerReferenceV01Schema,
  MDeployStorageRefV01Schema
)
export type MDeployArtifactEvidenceReferenceV01FromSchema =
  typeof MDeployArtifactEvidenceReferenceV01Schema.Type

export const MDeployArtifactSignerKindSchema = Schema.Literal('cosign-keyless', 'cosign-key-pair')
export type MDeployArtifactSignerKindFromSchema = typeof MDeployArtifactSignerKindSchema.Type

export const MDeployArtifactSignerV01Schema = Schema.Struct({
  kind: MDeployArtifactSignerKindSchema,
  identity: Schema.String,
  issuer: Schema.String
})
export type MDeployArtifactSignerV01FromSchema = typeof MDeployArtifactSignerV01Schema.Type

export const MDeployImageArtifactV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.image-artifact@0.1.0'),
  imageReference: Schema.String,
  digest: MDeployDigestSchema,
  sbomRef: MDeployArtifactEvidenceReferenceV01Schema,
  provenanceRef: MDeployArtifactEvidenceReferenceV01Schema,
  signatureRef: MDeployArtifactEvidenceReferenceV01Schema,
  signer: MDeployArtifactSignerV01Schema,
  verifiedAt: Schema.String
}).pipe(
  Schema.filter(artifact => imageReferenceMatchesDigest(artifact.imageReference, artifact.digest), {
    message: () => 'production image reference must contain only an immutable matching digest'
  })
)
export type MDeployImageArtifactV01FromSchema = typeof MDeployImageArtifactV01Schema.Type

export const MDeployImageArtifactValidationFailureSchema = Schema.Struct({
  code: Schema.Literal(
    'artifact_contract_invalid',
    'mutable_image_reference',
    'image_digest_mismatch',
    'missing_provenance'
  ),
  message: Schema.String
})
export type MDeployImageArtifactValidationFailureFromSchema =
  typeof MDeployImageArtifactValidationFailureSchema.Type

/**
 * 镜像准入先给出稳定的 typed failure，再由 Effect Schema 完成完整结构校验。
 */
export function validateMDeployImageArtifactV01(
  input: unknown
): Result<MDeployImageArtifactV01FromSchema, MDeployImageArtifactValidationFailureFromSchema> {
  if (!hasCompleteArtifactProvenance(input)) {
    return err({
      code: 'missing_provenance',
      message: 'image artifact requires SBOM, provenance, signature, and signer references'
    })
  }

  const imageReference = readStringField(input, 'imageReference')
  const digest = readDigestField(input)
  const referenceDigest = imageReference ? parseDigestOnlyImageReference(imageReference) : null
  if (referenceDigest === null) {
    return err({
      code: 'mutable_image_reference',
      message: 'production image reference must be digest-only and must not use a mutable tag'
    })
  }
  if (!digest || !isCanonicalDigest(digest)) {
    return err({ code: 'artifact_contract_invalid', message: 'image digest metadata is invalid' })
  }
  if (referenceDigest !== `${digest.algorithm}:${digest.value}`) {
    return err({
      code: 'image_digest_mismatch',
      message: 'image reference digest does not match artifact digest metadata'
    })
  }

  try {
    return ok(Schema.decodeUnknownSync(MDeployImageArtifactV01Schema)(input))
  } catch (error) {
    return err({ code: 'artifact_contract_invalid', message: errorMessage(error) })
  }
}

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

export const MDeployPromotionValidationFailureSchema = Schema.Struct({
  code: Schema.Literal(
    'promotion_contract_invalid',
    'promotion_source_target_invalid',
    'promotion_artifact_invalid',
    'rollback_pointer_invalid'
  ),
  message: Schema.String
})
export type MDeployPromotionValidationFailureFromSchema =
  typeof MDeployPromotionValidationFailureSchema.Type

/**
 * 生产 promotion 在保留可执行契约结构校验之外，拒绝无意义的环境跳转和不可恢复指针。
 */
export function validateMDeployPromotionV01(
  input: unknown
): Result<MDeployPromotionV01FromSchema, MDeployPromotionValidationFailureFromSchema> {
  if (typeof input !== 'object' || input === null) {
    return err({ code: 'promotion_contract_invalid', message: 'promotion must be an object' })
  }

  const artifact = validateMDeployImageArtifactV01(Reflect.get(input, 'artifact'))
  if (!artifact.ok) {
    return err({ code: 'promotion_artifact_invalid', message: artifact.error.message })
  }

  try {
    const promotion = Schema.decodeUnknownSync(MDeployPromotionV01Schema)(input)
    if (
      promotion.sourceEnvironment.trim().length === 0 ||
      promotion.targetEnvironment.trim().length === 0 ||
      promotion.sourceEnvironment === promotion.targetEnvironment
    ) {
      return err({
        code: 'promotion_source_target_invalid',
        message: 'promotion source and target environments must be distinct non-empty values'
      })
    }
    if (
      promotion.rollbackPointer.environment !== promotion.targetEnvironment ||
      !isCanonicalDigest(promotion.rollbackPointer.digest) ||
      (promotion.rollbackPointer.digest.algorithm === promotion.artifact.digest.algorithm &&
        promotion.rollbackPointer.digest.value === promotion.artifact.digest.value)
    ) {
      return err({
        code: 'rollback_pointer_invalid',
        message:
          'rollback pointer must target the promoted environment and a distinct canonical digest'
      })
    }
    return ok(promotion)
  } catch (error) {
    return err({ code: 'promotion_contract_invalid', message: errorMessage(error) })
  }
}

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

function hasCompleteArtifactProvenance(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  return ['sbomRef', 'provenanceRef', 'signatureRef', 'signer'].every(field =>
    Reflect.has(input, field)
  )
}

function readStringField(input: unknown, field: string): string | null {
  if (typeof input !== 'object' || input === null) return null
  const value = Reflect.get(input, field)
  return typeof value === 'string' ? value : null
}

function readDigestField(input: unknown): MDeployDigestFromSchema | null {
  if (typeof input !== 'object' || input === null) return null
  const digest = Reflect.get(input, 'digest')
  if (typeof digest !== 'object' || digest === null) return null
  const algorithm = Reflect.get(digest, 'algorithm')
  const value = Reflect.get(digest, 'value')
  if ((algorithm !== 'sha256' && algorithm !== 'sha512') || typeof value !== 'string') return null
  return { algorithm, value }
}

function parseDigestOnlyImageReference(reference: string): string | null {
  const separator = reference.lastIndexOf('@')
  if (separator <= 0 || separator !== reference.indexOf('@')) return null

  const repository = reference.slice(0, separator)
  const imageName = repository.slice(repository.lastIndexOf('/') + 1)
  if (imageName.length === 0 || imageName.includes(':')) return null

  const digest = reference.slice(separator + 1)
  return /^(sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/.test(digest) ? digest : null
}

function isCanonicalDigest(digest: MDeployDigestFromSchema): boolean {
  const expectedLength = digest.algorithm === 'sha256' ? 64 : 128
  return digest.value.length === expectedLength && /^[a-f0-9]+$/.test(digest.value)
}

function imageReferenceMatchesDigest(reference: string, digest: MDeployDigestFromSchema): boolean {
  return (
    isCanonicalDigest(digest) &&
    parseDigestOnlyImageReference(reference) === `${digest.algorithm}:${digest.value}`
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
