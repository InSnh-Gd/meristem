import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import { SecretRefSchema } from './secret-provider.ts'

export const MDeployDesiredStateSchemaVersionV01Schema = Schema.Literals([
  'mdeploy.desired-state@0.1.0'
])
export type MDeployDesiredStateSchemaVersionV01FromSchema =
  typeof MDeployDesiredStateSchemaVersionV01Schema.Type

export const MDeployRuntimeDriverSchema = Schema.Literals(['podman', 'docker'])
export type MDeployRuntimeDriverFromSchema = typeof MDeployRuntimeDriverSchema.Type

export const MDeployIacDriverSchema = Schema.Literals(['opentofu', 'terraform', 'disabled'])
export type MDeployIacDriverFromSchema = typeof MDeployIacDriverSchema.Type

export const MDeployDigestSchema = Schema.Struct({
  algorithm: Schema.Literals(['sha256', 'sha512']),
  value: Schema.String
})
export type MDeployDigestFromSchema = typeof MDeployDigestSchema.Type

export const MDeployGitSourceRefV01Schema = Schema.Struct({
  repositoryUrl: Schema.String,
  branch: Schema.String,
  commit: Schema.String,
  path: Schema.String,
  digest: MDeployDigestSchema,
  syncedAt: Schema.String
})
export type MDeployGitSourceRefV01FromSchema = typeof MDeployGitSourceRefV01Schema.Type

export const MDeployImageRefV01Schema = Schema.Struct({
  image: Schema.String,
  digest: MDeployDigestSchema,
  humanTag: Schema.optional(Schema.String)
})
export type MDeployImageRefV01FromSchema = typeof MDeployImageRefV01Schema.Type

export const MDeployRuntimeSelectionV01Schema = Schema.Struct({
  driver: MDeployRuntimeDriverSchema,
  iacDriver: MDeployIacDriverSchema,
  targetScope: Schema.Array(Schema.String)
})
export type MDeployRuntimeSelectionV01FromSchema = typeof MDeployRuntimeSelectionV01Schema.Type

export const MDeployTopologyNodeV01Schema = Schema.Struct({
  nodeId: Schema.String,
  hostId: Schema.String,
  role: Schema.Literals(['controller', 'worker']),
  runtimeDriver: MDeployRuntimeDriverSchema
})
export type MDeployTopologyNodeV01FromSchema = typeof MDeployTopologyNodeV01Schema.Type

export const MDeployTopologyV01Schema = Schema.Struct({
  topologyId: Schema.String,
  revision: Schema.String,
  nodes: Schema.Array(MDeployTopologyNodeV01Schema)
})
export type MDeployTopologyV01FromSchema = typeof MDeployTopologyV01Schema.Type

export const MDeployPlainConfigValueV01Schema = Schema.Struct({
  kind: Schema.Literal('plain'),
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
})
export type MDeployPlainConfigValueV01FromSchema = typeof MDeployPlainConfigValueV01Schema.Type

export const MDeploySecretConfigValueV01Schema = Schema.Struct({
  kind: Schema.Literal('secretRef'),
  secretRef: SecretRefSchema
})
export type MDeploySecretConfigValueV01FromSchema = typeof MDeploySecretConfigValueV01Schema.Type

export const MDeployServiceConfigValueV01Schema = Schema.Union([
  MDeployPlainConfigValueV01Schema,
  MDeploySecretConfigValueV01Schema
])
export type MDeployServiceConfigValueV01FromSchema = typeof MDeployServiceConfigValueV01Schema.Type

export const MDeployServiceConfigV01Schema = Schema.Struct({
  serviceId: Schema.String,
  image: MDeployImageRefV01Schema,
  config: Schema.Record(Schema.String, MDeployServiceConfigValueV01Schema),
  secretRefs: Schema.Array(SecretRefSchema)
})
export type MDeployServiceConfigV01FromSchema = typeof MDeployServiceConfigV01Schema.Type

const secretBearingKeyTerms = ['password', 'token', 'secret', 'key', 'credential'] as const

function isSecretBearingKey(key: string): boolean {
  const normalizedKey = key.toLowerCase()
  return secretBearingKeyTerms.some(term => normalizedKey.includes(term))
}

function collectSecretValueIssues(
  value: unknown,
  path: readonly string[]
): Array<Schema.FilterIssue> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSecretValueIssues(item, [...path, String(index)]))
  }
  if (typeof value !== 'object' || value === null) return []
  if (isSecretRefConfigValue(value)) {
    return collectSecretRefMetadataIssues(Reflect.get(value, 'secretRef'), [...path, 'secretRef'])
  }
  if (isSecretRef(value)) return collectSecretRefMetadataIssues(value, path)

  const issues: Array<Schema.FilterIssue> = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    if (isSecretBearingKey(key)) {
      if (!isApprovedSecretRepresentation(key, child)) {
        issues.push({
          path: childPath,
          issue: 'secret-bearing desired-state fields must use secretRef'
        })
      }
    }
    issues.push(...collectSecretValueIssues(child, childPath))
  }
  return issues
}

function isSecretRefConfigValue(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return Reflect.get(value, 'kind') === 'secretRef' && Reflect.has(value, 'secretRef')
}

function isSecretRef(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof Reflect.get(value, 'provider') === 'string' &&
    typeof Reflect.get(value, 'keyPath') === 'string'
  )
}

function collectSecretRefMetadataIssues(
  value: unknown,
  path: readonly string[]
): Array<Schema.FilterIssue> {
  if (typeof value !== 'object' || value === null || !Reflect.has(value, 'metadata')) return []
  return collectSecretValueIssues(Reflect.get(value, 'metadata'), [...path, 'metadata'])
}

function isApprovedSecretRepresentation(key: string, value: unknown): boolean {
  if (isSecretRefConfigValue(value)) return true
  return key === 'secretRefs' && Array.isArray(value)
}

export const MDeployDesiredStateDocumentV01Schema = Schema.Struct({
  schemaVersion: MDeployDesiredStateSchemaVersionV01Schema,
  source: MDeployGitSourceRefV01Schema,
  runtime: MDeployRuntimeSelectionV01Schema,
  topology: MDeployTopologyV01Schema,
  services: Schema.Array(MDeployServiceConfigV01Schema),
  generatedAt: Schema.String
}).pipe(Schema.check(Schema.makeFilter(document => collectSecretValueIssues(document, []))))
export type MDeployDesiredStateDocumentV01FromSchema =
  typeof MDeployDesiredStateDocumentV01Schema.Type

export const MDeploySignedEnvelopeSchemaVersionV01Schema = Schema.Literals([
  'mdeploy.signed-envelope@0.1.0'
])
export type MDeploySignedEnvelopeSchemaVersionV01FromSchema =
  typeof MDeploySignedEnvelopeSchemaVersionV01Schema.Type

export const MDeploySignatureAlgorithmSchema = Schema.Literals(['ed25519', 'cosign-keyless'])
export type MDeploySignatureAlgorithmFromSchema = typeof MDeploySignatureAlgorithmSchema.Type

export const MDeploySignatureV01Schema = Schema.Struct({
  algorithm: MDeploySignatureAlgorithmSchema,
  value: Schema.String,
  payloadDigest: MDeployDigestSchema
})
export type MDeploySignatureV01FromSchema = typeof MDeploySignatureV01Schema.Type

export const MDeploySignerIdentityV01Schema = Schema.Struct({
  kind: Schema.Literals(['mdeploy-controller', 'git-commit-signer', 'operator']),
  identity: Schema.String,
  keyRef: Schema.optional(SecretRefSchema)
})
export type MDeploySignerIdentityV01FromSchema = typeof MDeploySignerIdentityV01Schema.Type

export const MDeployEnvelopeVerificationV01Schema = Schema.Struct({
  verified: Schema.Boolean,
  verifiedAt: Schema.String,
  verifier: Schema.String,
  failureReason: Schema.optional(
    Schema.Literals(['unsigned', 'signature_mismatch', 'digest_mismatch', 'signer_not_trusted'])
  )
})
export type MDeployEnvelopeVerificationV01FromSchema =
  typeof MDeployEnvelopeVerificationV01Schema.Type

export const MDeploySignedEnvelopeV01Schema = Schema.Struct({
  schemaVersion: MDeploySignedEnvelopeSchemaVersionV01Schema,
  payload: MDeployDesiredStateDocumentV01Schema,
  signature: MDeploySignatureV01Schema,
  signer: MDeploySignerIdentityV01Schema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  verification: MDeployEnvelopeVerificationV01Schema
})
export type MDeploySignedEnvelopeV01FromSchema = typeof MDeploySignedEnvelopeV01Schema.Type

export const MDeploySignedManifestEnvelopeV01Schema = MDeploySignedEnvelopeV01Schema
export type MDeploySignedManifestEnvelopeV01FromSchema = MDeploySignedEnvelopeV01FromSchema

export const MDeployContractDecodeFailureSchema = Schema.Struct({
  code: Schema.Literal('schema_decode_failed'),
  message: Schema.String
})
export type MDeployContractDecodeFailureFromSchema = typeof MDeployContractDecodeFailureSchema.Type

export const MDeployDesiredStateValidationFailureSchema = Schema.Struct({
  code: Schema.Literals([
    'schema_decode_failed',
    'unsigned_desired_state',
    'signature_verification_failed',
    'stale_desired_state',
    'runtime_driver_mismatch'
  ]),
  message: Schema.String,
  detail: Schema.optional(Schema.String)
})
export type MDeployDesiredStateValidationFailureFromSchema =
  typeof MDeployDesiredStateValidationFailureSchema.Type

export type MDeployDesiredStateApplyContext = {
  readonly now: string
  readonly expectedRuntimeDriver: MDeployRuntimeDriverFromSchema
  readonly snapshotTtlMs: number
}

export function decodeMDeployDesiredStateDocumentV01(
  input: unknown
): Result<MDeployDesiredStateDocumentV01FromSchema, MDeployContractDecodeFailureFromSchema> {
  try {
    return ok(Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)(input))
  } catch (error) {
    return err({ code: 'schema_decode_failed', message: errorMessage(error) })
  }
}

export function encodeMDeployDesiredStateDocumentV01(
  input: MDeployDesiredStateDocumentV01FromSchema
): Result<unknown, MDeployContractDecodeFailureFromSchema> {
  try {
    return ok(Schema.encodeSync(MDeployDesiredStateDocumentV01Schema)(input))
  } catch (error) {
    return err({ code: 'schema_decode_failed', message: errorMessage(error) })
  }
}

export function decodeMDeploySignedEnvelopeV01(
  input: unknown
): Result<MDeploySignedEnvelopeV01FromSchema, MDeployContractDecodeFailureFromSchema> {
  try {
    return ok(Schema.decodeUnknownSync(MDeploySignedEnvelopeV01Schema)(input))
  } catch (error) {
    return err({ code: 'schema_decode_failed', message: errorMessage(error) })
  }
}

export function validateMDeploySignedEnvelopeForApply(
  input: unknown,
  context: MDeployDesiredStateApplyContext
): Result<MDeploySignedEnvelopeV01FromSchema, MDeployDesiredStateValidationFailureFromSchema> {
  if (isUnsignedDesiredStateDocument(input)) {
    return err({
      code: 'unsigned_desired_state',
      message: 'desired-state apply requires signed envelope'
    })
  }

  const decoded = decodeMDeploySignedEnvelopeV01(input)
  if (!decoded.ok) return err({ code: 'schema_decode_failed', message: decoded.error.message })

  const envelope = decoded.value
  // verification 是传输元数据而非授权事实；这里只验证结构，可信签名由调用方注入的 verifier 判定。
  if (envelope.signature.value.trim().length === 0) {
    return err({
      code: 'signature_verification_failed',
      message: 'desired-state envelope signature verification failed',
      detail: envelope.verification.failureReason
    })
  }
  if (
    envelope.signature.payloadDigest.algorithm !== envelope.payload.source.digest.algorithm ||
    envelope.signature.payloadDigest.value !== envelope.payload.source.digest.value
  ) {
    return err({
      code: 'signature_verification_failed',
      message: 'desired-state envelope digest does not match signed source digest',
      detail: 'digest_mismatch'
    })
  }
  if (isStaleEnvelope(envelope, context)) {
    return err({
      code: 'stale_desired_state',
      message: 'desired-state envelope is beyond apply TTL'
    })
  }
  if (envelope.payload.runtime.driver !== context.expectedRuntimeDriver) {
    return err({
      code: 'runtime_driver_mismatch',
      message: 'desired-state runtime driver does not match selected agent runtime',
      detail: `${envelope.payload.runtime.driver} != ${context.expectedRuntimeDriver}`
    })
  }
  return ok(envelope)
}

export const MDeployDesiredStateDocumentV00Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.desired-state@0.0.0'),
  repositoryUrl: Schema.String,
  branch: Schema.String,
  commit: Schema.String,
  path: Schema.String,
  digest: Schema.String,
  runtimeDriver: MDeployRuntimeDriverSchema,
  services: Schema.Array(MDeployServiceConfigV01Schema),
  generatedAt: Schema.String
})
export type MDeployDesiredStateDocumentV00FromSchema =
  typeof MDeployDesiredStateDocumentV00Schema.Type

export function migrateMDeployDesiredStateDocumentV00ToV01(
  input: MDeployDesiredStateDocumentV00FromSchema
): MDeployDesiredStateDocumentV01FromSchema {
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: input.repositoryUrl,
      branch: input.branch,
      commit: input.commit,
      path: input.path,
      digest: { algorithm: 'sha256', value: input.digest },
      syncedAt: input.generatedAt
    },
    runtime: { driver: input.runtimeDriver, iacDriver: 'disabled', targetScope: [] },
    topology: { topologyId: 'migrated-v00', revision: input.commit, nodes: [] },
    services: input.services,
    generatedAt: input.generatedAt
  }
}

function isUnsignedDesiredStateDocument(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  return Reflect.get(input, 'schemaVersion') === 'mdeploy.desired-state@0.1.0'
}

function isStaleEnvelope(
  envelope: MDeploySignedEnvelopeV01FromSchema,
  context: MDeployDesiredStateApplyContext
): boolean {
  const now = Date.parse(context.now)
  const expiresAt = Date.parse(envelope.expiresAt)
  const issuedAt = Date.parse(envelope.issuedAt)
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || !Number.isFinite(issuedAt))
    return true
  return now > expiresAt || now - issuedAt > context.snapshotTtlMs
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
