import { Schema } from 'effect'

export const ConfigDomainSchema = Schema.Literal(
  'core',
  'm-net',
  'm-policy',
  'm-log',
  'm-extension',
  'm-ui'
)
export type ConfigDomainFromSchema = typeof ConfigDomainSchema.Type

export const ConfigStatusSchema = Schema.Literal(
  'draft',
  'validated',
  'published',
  'applied',
  'failed',
  'rolled_back'
)
export type ConfigStatusFromSchema = typeof ConfigStatusSchema.Type

export const ConfigAckStatusSchema = Schema.Literal('pending', 'acked', 'failed')
export type ConfigAckStatusFromSchema = typeof ConfigAckStatusSchema.Type

export const ConfigRecordV01 = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  domain: ConfigDomainSchema,
  targetScope: Schema.Array(Schema.String),
  status: ConfigStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  publishedBy: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  rollbackVersion: Schema.optional(Schema.String)
})

export const ConfigRecordV01Schema = ConfigRecordV01

export const ConfigVersionV01 = Schema.Struct({
  id: Schema.String,
  configId: Schema.String,
  version: Schema.String,
  configHash: Schema.String,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  status: ConfigStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String
})

export const ConfigVersionV01Schema = ConfigVersionV01

export const ConfigTransitionV01 = Schema.Struct({
  id: Schema.String,
  configId: Schema.String,
  fromStatus: Schema.String,
  toStatus: Schema.String,
  actor: Schema.String,
  reason: Schema.optional(Schema.String),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  createdAt: Schema.String
})

export const ConfigTransitionV01Schema = ConfigTransitionV01

export const ConfigApplyAckV01 = Schema.Struct({
  id: Schema.String,
  configId: Schema.String,
  version: Schema.String,
  targetService: Schema.String,
  status: ConfigAckStatusSchema,
  error: Schema.optional(Schema.String),
  ackedAt: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
  createdAt: Schema.String
})

export const ConfigApplyAckV01Schema = ConfigApplyAckV01

export type ConfigRecordV01 = typeof ConfigRecordV01.Type
export type ConfigVersionV01 = typeof ConfigVersionV01.Type
export type ConfigTransitionV01 = typeof ConfigTransitionV01.Type
export type ConfigApplyAckV01 = typeof ConfigApplyAckV01.Type

export const ConfigListRecordSchema = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  domain: ConfigDomainSchema,
  status: ConfigStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String
})
export type ConfigListRecordFromSchema = typeof ConfigListRecordSchema.Type

export const ConfigDetailRecordSchema = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  domain: ConfigDomainSchema,
  status: ConfigStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  targetScope: Schema.Array(Schema.String),
  payload: Schema.Unknown,
  updatedAt: Schema.String,
  publishedBy: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  rollbackVersion: Schema.optional(Schema.String)
})
export type ConfigDetailRecordFromSchema = typeof ConfigDetailRecordSchema.Type

export const ConfigListResponseSchema = Schema.Struct({
  configs: Schema.Array(ConfigListRecordSchema)
})
export type ConfigListResponseFromSchema = typeof ConfigListResponseSchema.Type

export const ConfigDetailResponseSchema = Schema.Struct({
  config: ConfigDetailRecordSchema
})
export type ConfigDetailResponseFromSchema = typeof ConfigDetailResponseSchema.Type

export const ConfigDraftResponseSchema = Schema.Struct({
  config: Schema.Struct({
    id: Schema.String,
    configVersion: Schema.String,
    status: Schema.Literal('draft'),
    createdAt: Schema.String
  })
})
export type ConfigDraftResponseFromSchema = typeof ConfigDraftResponseSchema.Type

export const ConfigValidateResponseSchema = Schema.Struct({
  config: Schema.Struct({
    id: Schema.String,
    status: Schema.Literal('validated')
  })
})
export type ConfigValidateResponseFromSchema = typeof ConfigValidateResponseSchema.Type

export const ConfigPublishResponseSchema = Schema.Struct({
  config: Schema.Struct({
    id: Schema.String,
    configVersion: Schema.String,
    status: Schema.Literal('published'),
    publishedAt: Schema.String,
    publishedBy: Schema.String
  })
})
export type ConfigPublishResponseFromSchema = typeof ConfigPublishResponseSchema.Type

export const ConfigRollbackResponseSchema = Schema.Struct({
  config: Schema.Struct({
    id: Schema.String,
    status: Schema.Literal('rolled_back')
  })
})
export type ConfigRollbackResponseFromSchema = typeof ConfigRollbackResponseSchema.Type

export const ConfigApplyAckResponseSchema = Schema.Struct({
  ack: Schema.Struct({
    ackId: Schema.String,
    configId: Schema.String,
    configVersion: Schema.String,
    ackedBy: Schema.String,
    status: Schema.Literal('acked', 'failed'),
    ackedAt: Schema.String,
    errorCode: Schema.optional(Schema.String),
    errorMessage: Schema.optional(Schema.String)
  })
})
export type ConfigApplyAckResponseFromSchema = typeof ConfigApplyAckResponseSchema.Type
