import * as Schema from 'effect/Schema'

export const ConfigDomainV01Schema = Schema.Literal(
  'core',
  'm-net',
  'm-policy',
  'm-log',
  'm-extension',
  'm-ui'
)

export const ConfigStatusV01Schema = Schema.Literal(
  'draft',
  'validated',
  'published',
  'applied',
  'failed',
  'rolled_back'
)

export const ConfigRecordV01Schema = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  domain: ConfigDomainV01Schema,
  targetScope: Schema.Array(Schema.String),
  status: ConfigStatusV01Schema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  publishedBy: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  rollbackVersion: Schema.optional(Schema.String)
})

export const ConfigApplyAckV01Schema = Schema.Struct({
  ackId: Schema.String,
  configId: Schema.String,
  configVersion: Schema.String,
  ackedBy: Schema.String,
  ackedAt: Schema.String,
  status: Schema.Literal('acked', 'failed'),
  errorCode: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String)
})
