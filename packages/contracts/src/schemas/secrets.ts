import * as Schema from 'effect/Schema'

export const SecretScopeSchema = Schema.Literal('system', 'service', 'node')
export type SecretScopeFromSchema = typeof SecretScopeSchema.Type

export const SecretStatusSchema = Schema.Literal('active', 'rotated', 'disabled')
export type SecretStatusFromSchema = typeof SecretStatusSchema.Type

export const SecretMetadataSchema = Schema.Record({ key: Schema.String, value: Schema.String })
export type SecretMetadataFromSchema = typeof SecretMetadataSchema.Type

export const SecretRefV01 = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: SecretScopeSchema,
  owner: Schema.Literal('core'),
  status: SecretStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: SecretMetadataSchema
})

export const SecretRefVersionV01 = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  version: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.String,
  disabledAt: Schema.optional(Schema.String)
})

export const SecretRefTransitionV01 = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  fromStatus: Schema.String,
  toStatus: Schema.String,
  actor: Schema.String,
  reason: Schema.optional(Schema.String),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  createdAt: Schema.String
})

export const SecretRefV01Schema = SecretRefV01
export const SecretRefVersionSchema = SecretRefVersionV01
export const SecretRefTransitionSchema = SecretRefTransitionV01

export type SecretRefV01 = typeof SecretRefV01.Type
export type SecretRefVersionV01 = typeof SecretRefVersionV01.Type
export type SecretRefTransitionV01 = typeof SecretRefTransitionV01.Type

export const SecretListRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  scope: Schema.String,
  status: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.String,
  metadata: SecretMetadataSchema
})
export type SecretListRecordFromSchema = typeof SecretListRecordSchema.Type

export const SecretDetailRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  scope: Schema.String,
  status: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.String,
  metadata: SecretMetadataSchema,
  updatedAt: Schema.String
})
export type SecretDetailRecordFromSchema = typeof SecretDetailRecordSchema.Type

export const SecretCreateRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  createdAt: Schema.String
})
export type SecretCreateRecordFromSchema = typeof SecretCreateRecordSchema.Type

export const SecretRotateRecordSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  status: Schema.String,
  rotatedAt: Schema.String
})
export type SecretRotateRecordFromSchema = typeof SecretRotateRecordSchema.Type

export const SecretDisableRecordSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  disabledAt: Schema.String
})
export type SecretDisableRecordFromSchema = typeof SecretDisableRecordSchema.Type

export const SecretReferenceRecordSchema = Schema.Struct({
  id: Schema.String,
  currentVersion: Schema.String,
  status: Schema.String,
  metadata: SecretMetadataSchema
})
export type SecretReferenceRecordFromSchema = typeof SecretReferenceRecordSchema.Type

export const SecretListResponseSchema = Schema.Array(SecretListRecordSchema)
export type SecretListResponseFromSchema = typeof SecretListResponseSchema.Type

export const SecretDetailResponseSchema = SecretDetailRecordSchema
export type SecretDetailResponseFromSchema = typeof SecretDetailResponseSchema.Type

export const SecretCreateResponseSchema = SecretCreateRecordSchema
export type SecretCreateResponseFromSchema = typeof SecretCreateResponseSchema.Type

export const SecretRotateResponseSchema = SecretRotateRecordSchema
export type SecretRotateResponseFromSchema = typeof SecretRotateResponseSchema.Type

export const SecretDisableResponseSchema = SecretDisableRecordSchema
export type SecretDisableResponseFromSchema = typeof SecretDisableResponseSchema.Type

export const SecretReferenceResponseSchema = SecretReferenceRecordSchema
export type SecretReferenceResponseFromSchema = typeof SecretReferenceResponseSchema.Type
