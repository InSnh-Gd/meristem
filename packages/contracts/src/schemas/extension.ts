import * as Schema from 'effect/Schema'
import { actorIds, permissions } from '../literals.ts'
import { mExtensionEventSubjects, mExtensionManifestVersion, mExtensionScope } from '../types/extension.ts'

export const MExtensionManifestVersionSchema = Schema.Literal(mExtensionManifestVersion)
export const MExtensionKindSchema = Schema.Literal('metadata-only', 'webhook-declared', 'wasm-placeholder', 'http-callback-placeholder')
export const MExtensionRiskClassSchema = Schema.Literal('low', 'medium')
export const MExtensionLifecycleStatusSchema = Schema.Literal('draft', 'active', 'deprecated')
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
  futureResourceLimits: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
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
