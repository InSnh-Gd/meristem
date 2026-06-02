import * as Schema from 'effect/Schema'

export const SecretRefV01 = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: Schema.Literal('system', 'service', 'node'),
  owner: Schema.Literal('core'),
  status: Schema.Literal('active', 'rotated', 'disabled'),
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
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
