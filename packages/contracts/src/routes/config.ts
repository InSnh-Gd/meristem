import * as Schema from 'effect/Schema'
import {
  ConfigApplyAckResponseSchema,
  ConfigDetailResponseSchema,
  ConfigDomainSchema,
  ConfigDraftResponseSchema,
  ConfigListResponseSchema,
  ConfigPublishResponseSchema,
  ConfigRollbackResponseSchema,
  ConfigValidateResponseSchema
} from '../schemas/config.ts'

export const configApiRoutes = {
  collection: '/api/v0/configs',
  detail: '/api/v0/configs/:id',
  drafts: '/api/v0/configs/drafts',
  validate: '/api/v0/configs/:id/validate',
  publish: '/api/v0/configs/:id/publish',
  rollback: '/api/v0/configs/:id/rollback',
  applyAck: '/internal/v0/configs/:id/apply-ack'
} as const

export const ConfigRouteParamsSchema = Schema.Struct({
  id: Schema.String
})
export type ConfigRouteParamsFromSchema = typeof ConfigRouteParamsSchema.Type

export const ConfigDraftRequestSchema = Schema.Struct({
  domain: ConfigDomainSchema,
  payload: Schema.Unknown,
  targetScope: Schema.optional(Schema.Array(Schema.String))
})
export type ConfigDraftRequestFromSchema = typeof ConfigDraftRequestSchema.Type

export const ConfigPublishRequestSchema = Schema.Struct({
  reason: Schema.String
})
export type ConfigPublishRequestFromSchema = typeof ConfigPublishRequestSchema.Type

export const ConfigRollbackRequestSchema = Schema.Struct({
  toVersion: Schema.String,
  reason: Schema.String
})
export type ConfigRollbackRequestFromSchema = typeof ConfigRollbackRequestSchema.Type

export const ConfigApplyAckRouteStatusSchema = Schema.Literal('acked', 'failed')
export type ConfigApplyAckRouteStatusFromSchema = typeof ConfigApplyAckRouteStatusSchema.Type

export const ConfigApplyAckRequestSchema = Schema.Struct({
  version: Schema.optional(Schema.String),
  configVersion: Schema.optional(Schema.String),
  targetService: Schema.optional(Schema.String),
  ackedBy: Schema.optional(Schema.String),
  status: ConfigApplyAckRouteStatusSchema,
  error: Schema.optional(Schema.String),
  errorCode: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String)
})
export type ConfigApplyAckRequestFromSchema = typeof ConfigApplyAckRequestSchema.Type

export const configRouteContracts = {
  list: {
    method: 'GET',
    path: configApiRoutes.collection,
    responseSchema: ConfigListResponseSchema
  },
  detail: {
    method: 'GET',
    path: configApiRoutes.detail,
    paramsSchema: ConfigRouteParamsSchema,
    responseSchema: ConfigDetailResponseSchema
  },
  draft: {
    method: 'POST',
    path: configApiRoutes.drafts,
    requestSchema: ConfigDraftRequestSchema,
    responseSchema: ConfigDraftResponseSchema
  },
  validate: {
    method: 'POST',
    path: configApiRoutes.validate,
    paramsSchema: ConfigRouteParamsSchema,
    responseSchema: ConfigValidateResponseSchema
  },
  publish: {
    method: 'POST',
    path: configApiRoutes.publish,
    paramsSchema: ConfigRouteParamsSchema,
    requestSchema: ConfigPublishRequestSchema,
    responseSchema: ConfigPublishResponseSchema
  },
  rollback: {
    method: 'POST',
    path: configApiRoutes.rollback,
    paramsSchema: ConfigRouteParamsSchema,
    requestSchema: ConfigRollbackRequestSchema,
    responseSchema: ConfigRollbackResponseSchema
  },
  applyAck: {
    method: 'POST',
    path: configApiRoutes.applyAck,
    paramsSchema: ConfigRouteParamsSchema,
    requestSchema: ConfigApplyAckRequestSchema,
    responseSchema: ConfigApplyAckResponseSchema
  }
} as const
