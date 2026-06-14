import { t } from 'elysia'
import {
  mExtensionManifestVersion,
  mExtensionScope
} from '../../../packages/contracts/src/types/extension.ts'

export const errorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

export const manifestSchema = t.Object({
  id: t.String(),
  manifestVersion: t.Literal(mExtensionManifestVersion),
  displayName: t.String(),
  description: t.Optional(t.String()),
  kind: t.Union([
    t.Literal('metadata-only'),
    t.Literal('webhook-declared'),
    t.Literal('wasm-placeholder'),
    t.Literal('http-callback-placeholder')
  ]),
  owner: t.String(),
  license: t.String(),
  declaredCapabilities: t.Array(t.String()),
  requestedPermissions: t.Array(t.String()),
  configSchemaRef: t.Optional(t.String()),
  requestedEvents: t.Optional(t.Array(t.String())),
  emittedEvents: t.Optional(t.Array(t.String())),
  riskClass: t.Union([t.Literal('low'), t.Literal('medium')]),
  lifecycleStatus: t.Union([t.Literal('draft'), t.Literal('active'), t.Literal('deprecated')]),
  controlPlaneOnly: t.Literal(true),
  futureEntrypoint: t.Optional(t.String()),
  futureRuntime: t.Optional(t.String()),
  futureWebhookVerification: t.Optional(t.String()),
  futureResourceLimits: t.Optional(t.Record(t.String(), t.Unknown())),
  createdAt: t.Optional(t.String()),
  updatedAt: t.Optional(t.String())
})

export const registerManifestSchema = t.Object({
  ...manifestSchema.properties,
  kind: t.String(),
  riskClass: t.String(),
  futureResourceLimits: t.Optional(t.Record(t.String(), t.Unknown()))
})

export const instanceSchema = t.Object({
  id: t.String(),
  extensionId: t.String(),
  scopeType: t.Literal(mExtensionScope.type),
  scopeId: t.Literal(mExtensionScope.id),
  status: t.Union([
    t.Literal('disabled'),
    t.Literal('enabled'),
    t.Literal('enable_failed'),
    t.Literal('disable_failed')
  ]),
  enabledBy: t.Optional(t.String()),
  disabledBy: t.Optional(t.String()),
  policyDecisionId: t.Optional(t.String()),
  correlationId: t.Optional(t.String()),
  lastError: t.Optional(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  enabledAt: t.Optional(t.String()),
  disabledAt: t.Optional(t.String())
})

export const definitionSchema = t.Object({
  id: t.String(),
  manifestVersion: t.Literal(mExtensionManifestVersion),
  kind: t.Union([
    t.Literal('metadata-only'),
    t.Literal('webhook-declared'),
    t.Literal('wasm-placeholder'),
    t.Literal('http-callback-placeholder')
  ]),
  displayName: t.String(),
  owner: t.String(),
  license: t.String(),
  manifest: manifestSchema,
  declaredCapabilities: t.Array(t.String()),
  requestedPermissions: t.Array(t.String()),
  riskClass: t.Union([t.Literal('low'), t.Literal('medium')]),
  status: t.Union([t.Literal('registered'), t.Literal('rejected'), t.Literal('deprecated')]),
  registeredBy: t.String(),
  policyDecisionId: t.String(),
  correlationId: t.String(),
  createdAt: t.String(),
  updatedAt: t.String()
})

export const extensionPairSchema = t.Object({
  definition: definitionSchema,
  instance: t.Optional(instanceSchema)
})

export const registerBodySchema = t.Object({
  manifest: registerManifestSchema,
  reason: t.Optional(t.String())
})

export const controlBodySchema = t.Object({
  scopeType: t.Optional(t.String()),
  scopeId: t.Optional(t.String()),
  reason: t.Optional(t.String())
})
