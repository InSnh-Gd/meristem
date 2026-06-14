import * as Schema from 'effect/Schema'
import {
  SecretCreateResponseSchema,
  SecretDetailResponseSchema,
  SecretDisableResponseSchema,
  SecretListResponseSchema,
  SecretMetadataSchema,
  SecretReferenceResponseSchema,
  SecretRotateResponseSchema,
  SecretScopeSchema
} from '../schemas/secrets.ts'

export const secretApiRoutes = {
  collection: '/api/v0/secrets',
  detail: '/api/v0/secrets/:id',
  create: '/api/v0/secrets',
  rotate: '/api/v0/secrets/:id/rotate',
  disable: '/api/v0/secrets/:id/disable',
  reference: '/internal/v0/secrets/:id/reference'
} as const

export const SecretRouteParamsSchema = Schema.Struct({
  id: Schema.String
})
export type SecretRouteParamsFromSchema = typeof SecretRouteParamsSchema.Type

export const SecretCreateRequestSchema = Schema.Struct({
  name: Schema.String,
  scope: SecretScopeSchema,
  value: Schema.String,
  metadata: Schema.optional(SecretMetadataSchema)
})
export type SecretCreateRequestFromSchema = typeof SecretCreateRequestSchema.Type

export const SecretRotateRequestSchema = Schema.Struct({
  value: Schema.String,
  reason: Schema.String
})
export type SecretRotateRequestFromSchema = typeof SecretRotateRequestSchema.Type

export const SecretDisableRequestSchema = Schema.Struct({
  reason: Schema.String
})
export type SecretDisableRequestFromSchema = typeof SecretDisableRequestSchema.Type

export const secretRouteContracts = {
  list: {
    method: 'GET',
    path: secretApiRoutes.collection,
    responseSchema: SecretListResponseSchema
  },
  detail: {
    method: 'GET',
    path: secretApiRoutes.detail,
    paramsSchema: SecretRouteParamsSchema,
    responseSchema: SecretDetailResponseSchema
  },
  create: {
    method: 'POST',
    path: secretApiRoutes.create,
    requestSchema: SecretCreateRequestSchema,
    responseSchema: SecretCreateResponseSchema
  },
  rotate: {
    method: 'POST',
    path: secretApiRoutes.rotate,
    paramsSchema: SecretRouteParamsSchema,
    requestSchema: SecretRotateRequestSchema,
    responseSchema: SecretRotateResponseSchema
  },
  disable: {
    method: 'POST',
    path: secretApiRoutes.disable,
    paramsSchema: SecretRouteParamsSchema,
    requestSchema: SecretDisableRequestSchema,
    responseSchema: SecretDisableResponseSchema
  },
  reference: {
    method: 'POST',
    path: secretApiRoutes.reference,
    paramsSchema: SecretRouteParamsSchema,
    responseSchema: SecretReferenceResponseSchema
  }
} as const
