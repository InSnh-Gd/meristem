import { Schema } from 'effect'

export const ConfigRecordV01 = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  domain: Schema.Literal('core', 'm-net', 'm-policy', 'm-log', 'm-extension', 'm-ui'),
  targetScope: Schema.Array(Schema.String),
  status: Schema.Literal('draft', 'validated', 'published', 'applied', 'failed', 'rolled_back'),
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
  status: Schema.Literal('draft', 'validated', 'published', 'applied', 'failed', 'rolled_back'),
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
  status: Schema.Literal('pending', 'acked', 'failed'),
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
