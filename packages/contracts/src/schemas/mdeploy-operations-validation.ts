import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import type { MDeployDigestFromSchema } from './mdeploy-common.ts'
import {
  MDeployImageArtifactV01Schema,
  type MDeployImageArtifactV01FromSchema,
  type MDeployImageArtifactValidationFailureFromSchema
} from './mdeploy-operations-artifacts.ts'
import {
  MDeployPromotionV01Schema,
  type MDeployPromotionV01FromSchema
} from './mdeploy-operations-lifecycle.ts'

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
