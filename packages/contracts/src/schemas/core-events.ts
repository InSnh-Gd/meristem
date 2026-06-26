import * as Schema from 'effect/Schema'

export const CoreLifecycleStartedPayloadSchema = Schema.Struct({
  nodeId: Schema.String,
  startedAt: Schema.String,
  version: Schema.String
})
export type CoreLifecycleStartedPayloadFromSchema = typeof CoreLifecycleStartedPayloadSchema.Type

export const ServiceLifecycleRegisteredPayloadSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  domain: Schema.String,
  kind: Schema.String
})
export type ServiceLifecycleRegisteredPayloadFromSchema =
  typeof ServiceLifecycleRegisteredPayloadSchema.Type

export const ServiceLifecycleReloadRequestedPayloadSchema = Schema.Struct({
  serviceId: Schema.String,
  reason: Schema.optional(Schema.String)
})
export type ServiceLifecycleReloadRequestedPayloadFromSchema =
  typeof ServiceLifecycleReloadRequestedPayloadSchema.Type
