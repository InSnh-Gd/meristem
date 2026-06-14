import * as Schema from 'effect/Schema'
import { actorIds, permissions } from '../literals.ts'
import {
  mExtensionEventSubjects,
  mExtensionManifestVersion,
  mExtensionScope
} from '../types/extension.ts'

export const MExtensionManifestVersionSchema = Schema.Literal(mExtensionManifestVersion)
export const MExtensionKindSchema = Schema.Literal(
  'metadata-only',
  'webhook-declared',
  'wasm-placeholder',
  'http-callback-placeholder'
)
export const MExtensionRiskClassSchema = Schema.Literal('low', 'medium')
export const MExtensionLifecycleStatusSchema = Schema.Literal('draft', 'active', 'deprecated')
export const MExtensionDefinitionStatusSchema = Schema.Literal(
  'registered',
  'rejected',
  'deprecated'
)
export const MExtensionInstanceStatusSchema = Schema.Literal(
  'disabled',
  'enabled',
  'enable_failed',
  'disable_failed'
)
export const MExtensionScopeTypeSchema = Schema.Literal(mExtensionScope.type)
export const MExtensionScopeIdSchema = Schema.Literal(mExtensionScope.id)
export const MExtensionPermissionSchema = Schema.Literal(...permissions)

export const MExtensionManifestV01Schema = Schema.Struct({
  id: Schema.String,
  manifestVersion: MExtensionManifestVersionSchema,
  displayName: Schema.String,
  description: Schema.optional(Schema.String),
  kind: MExtensionKindSchema,
  owner: Schema.String,
  license: Schema.String,
  declaredCapabilities: Schema.Array(Schema.String),
  requestedPermissions: Schema.Array(MExtensionPermissionSchema),
  configSchemaRef: Schema.optional(Schema.String),
  requestedEvents: Schema.optional(Schema.Array(Schema.String)),
  emittedEvents: Schema.optional(Schema.Array(Schema.String)),
  riskClass: MExtensionRiskClassSchema,
  lifecycleStatus: MExtensionLifecycleStatusSchema,
  controlPlaneOnly: Schema.Literal(true),
  futureEntrypoint: Schema.optional(Schema.String),
  futureRuntime: Schema.optional(Schema.String),
  futureWebhookVerification: Schema.optional(Schema.String),
  futureResourceLimits: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String)
})
export type MExtensionManifestV01FromSchema = typeof MExtensionManifestV01Schema.Type

export const MExtensionEventSubjectSchema = Schema.Literal(
  mExtensionEventSubjects.definitionRegistered,
  mExtensionEventSubjects.definitionRejected,
  mExtensionEventSubjects.instanceEnabled,
  mExtensionEventSubjects.instanceDisabled,
  mExtensionEventSubjects.instanceEnableFailed,
  mExtensionEventSubjects.instanceDisableFailed
)

export const MExtensionLifecyclePayloadSchema = Schema.Struct({
  extensionId: Schema.String,
  manifestVersion: MExtensionManifestVersionSchema,
  kind: MExtensionKindSchema,
  actor: Schema.Literal(...actorIds),
  decisionId: Schema.String,
  scopeType: MExtensionScopeTypeSchema,
  scopeId: MExtensionScopeIdSchema,
  reason: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  errorCode: Schema.optional(Schema.String)
})
export type MExtensionLifecyclePayloadFromSchema = typeof MExtensionLifecyclePayloadSchema.Type

export const MExtensionInstanceSchema = Schema.Struct({
  id: Schema.String,
  extensionId: Schema.String,
  scopeType: MExtensionScopeTypeSchema,
  scopeId: MExtensionScopeIdSchema,
  status: MExtensionInstanceStatusSchema,
  enabledBy: Schema.optional(Schema.Literal(...actorIds)),
  disabledBy: Schema.optional(Schema.Literal(...actorIds)),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  lastError: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  enabledAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String)
})
export type MExtensionInstanceFromSchema = typeof MExtensionInstanceSchema.Type

export const MExtensionDefinitionSchema = Schema.Struct({
  id: Schema.String,
  manifestVersion: MExtensionManifestVersionSchema,
  kind: MExtensionKindSchema,
  displayName: Schema.String,
  owner: Schema.String,
  license: Schema.String,
  manifest: MExtensionManifestV01Schema,
  declaredCapabilities: Schema.Array(Schema.String),
  requestedPermissions: Schema.Array(MExtensionPermissionSchema),
  riskClass: MExtensionRiskClassSchema,
  status: MExtensionDefinitionStatusSchema,
  registeredBy: Schema.Literal(...actorIds),
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type MExtensionDefinitionFromSchema = typeof MExtensionDefinitionSchema.Type

export const ExtensionPairSchema = Schema.Struct({
  definition: MExtensionDefinitionSchema,
  instance: Schema.optional(MExtensionInstanceSchema)
})
export type ExtensionPairFromSchema = typeof ExtensionPairSchema.Type

export const ExtensionListResponseSchema = Schema.Struct({
  extensions: Schema.Array(ExtensionPairSchema)
})
export type ExtensionListResponseFromSchema = typeof ExtensionListResponseSchema.Type

export const ExtensionDetailResponseSchema = ExtensionPairSchema
export type ExtensionDetailResponseFromSchema = typeof ExtensionDetailResponseSchema.Type

export const RegisterExtensionResponseSchema = Schema.Struct({
  definition: MExtensionDefinitionSchema,
  instance: Schema.optional(MExtensionInstanceSchema),
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type RegisterExtensionResponseFromSchema = typeof RegisterExtensionResponseSchema.Type

export const ExtensionInstanceControlResponseSchema = Schema.Struct({
  definition: MExtensionDefinitionSchema,
  instance: MExtensionInstanceSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type ExtensionInstanceControlResponseFromSchema =
  typeof ExtensionInstanceControlResponseSchema.Type
