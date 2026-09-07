import * as Schema from 'effect/Schema'
import { type MDeployDigestFromSchema, MDeployDigestSchema } from './mdeploy-common.ts'

export const MDeployOpenTofuStatusSchema = Schema.Literals([
  'not_started',
  'planning',
  'planned',
  'applying',
  'succeeded',
  'failed',
  'skipped'
])
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

export const MDeployEvidenceTypeSchema = Schema.Literals([
  'signature_verification',
  'runtime_plan',
  'runtime_apply',
  'opentofu_plan',
  'opentofu_apply',
  'agent_ack',
  'drift_report',
  'rollback'
])
export type MDeployEvidenceTypeFromSchema = typeof MDeployEvidenceTypeSchema.Type

export const MDeployStorageRefV01Schema = Schema.Struct({
  uri: Schema.String,
  digest: MDeployDigestSchema,
  redactionStatus: Schema.Literals(['redacted', 'metadata_only'])
})
export type MDeployStorageRefV01FromSchema = typeof MDeployStorageRefV01Schema.Type

export const MDeployOciReferrerArtifactSchema = Schema.Literals(['signature', 'attestation'])
export type MDeployOciReferrerArtifactFromSchema = typeof MDeployOciReferrerArtifactSchema.Type

export const MDeployOciReferrerVerificationV01Schema = Schema.Struct({
  tool: Schema.Literal('cosign'),
  operation: Schema.Literals(['download-signature', 'download-attestation'])
})
export type MDeployOciReferrerVerificationV01FromSchema =
  typeof MDeployOciReferrerVerificationV01Schema.Type

/** OCI referrer references retain the subject and retrieval operation so consumers can re-verify durable registry evidence. */
export const MDeployOciReferrerReferenceV01Schema = Schema.Struct({
  uri: Schema.String,
  digest: MDeployDigestSchema,
  redactionStatus: Schema.Literals(['redacted', 'metadata_only']),
  subjectDigest: MDeployDigestSchema,
  artifact: MDeployOciReferrerArtifactSchema,
  predicateType: Schema.optional(Schema.String),
  verification: MDeployOciReferrerVerificationV01Schema
}).pipe(
  Schema.check(
    Schema.makeFilter(
      reference => {
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
      },
      {
        message: 'OCI referrer artifact and Cosign retrieval operation must agree'
      }
    )
  )
)
export type MDeployOciReferrerReferenceV01FromSchema =
  typeof MDeployOciReferrerReferenceV01Schema.Type

export const MDeployArtifactEvidenceReferenceV01Schema = Schema.Union([
  MDeployOciReferrerReferenceV01Schema,
  MDeployStorageRefV01Schema
])
export type MDeployArtifactEvidenceReferenceV01FromSchema =
  typeof MDeployArtifactEvidenceReferenceV01Schema.Type

export const MDeployArtifactSignerKindSchema = Schema.Literals([
  'cosign-keyless',
  'cosign-key-pair'
])
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
  Schema.check(
    Schema.makeFilter(
      artifact => imageReferenceMatchesDigest(artifact.imageReference, artifact.digest),
      {
        message: 'production image reference must contain only an immutable matching digest'
      }
    )
  )
)
export type MDeployImageArtifactV01FromSchema = typeof MDeployImageArtifactV01Schema.Type

export const MDeployImageArtifactValidationFailureSchema = Schema.Struct({
  code: Schema.Literals([
    'artifact_contract_invalid',
    'mutable_image_reference',
    'image_digest_mismatch',
    'missing_provenance'
  ]),
  message: Schema.String
})
export type MDeployImageArtifactValidationFailureFromSchema =
  typeof MDeployImageArtifactValidationFailureSchema.Type

function imageReferenceMatchesDigest(reference: string, digest: MDeployDigestFromSchema): boolean {
  return (
    isCanonicalDigest(digest) &&
    parseDigestOnlyImageReference(reference) === `${digest.algorithm}:${digest.value}`
  )
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
