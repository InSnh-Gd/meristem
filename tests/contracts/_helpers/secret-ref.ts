import * as Schema from 'effect/Schema'

export const SecretRefScopeSchema = Schema.Literal('system', 'service', 'node')

export const SecretRefStatusSchema = Schema.Literal('active', 'rotated', 'disabled')

export const SecretRefV01Schema = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: SecretRefScopeSchema,
  owner: Schema.Literal('core'),
  status: SecretRefStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
})

export const SecretRefVersionSchema = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  version: Schema.Number,
  createdBy: Schema.String,
  createdAt: Schema.String,
  disabledAt: Schema.optional(Schema.String)
})

export const SecretRefTransitionSchema = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  fromStatus: SecretRefStatusSchema,
  toStatus: SecretRefStatusSchema,
  actor: Schema.String,
  reason: Schema.optional(Schema.String),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  createdAt: Schema.String
})

export const SecretRefDTOSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: SecretRefScopeSchema,
  owner: Schema.Literal('core'),
  status: SecretRefStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
})
