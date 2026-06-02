import type { ActorId, Permission } from '../literals.ts'

export type MExtensionManifestVersion = 'm-extension-manifest@0.1.0'
export type MExtensionKind = 'metadata-only' | 'webhook-declared' | 'wasm-placeholder' | 'http-callback-placeholder'
export type MExtensionRiskClass = 'low' | 'medium'
export type MExtensionLifecycleStatus = 'draft' | 'active' | 'deprecated'
export type MExtensionDefinitionStatus = 'registered' | 'rejected' | 'deprecated'
export type MExtensionInstanceStatus = 'disabled' | 'enabled' | 'enable_failed' | 'disable_failed'
export type MExtensionScopeType = 'system'
export type MExtensionScopeId = 'default'

export const mExtensionServiceName = 'm-extension' as const
export const mExtensionApiVersion = '0.1.0' as const
export const mExtensionManifestVersion = 'm-extension-manifest@0.1.0' as const
export const mExtensionScope = { type: 'system', id: 'default' } as const
export const mExtensionResource = { collection: 'extensions', prefix: 'extension' } as const
export const mExtensionApiRoutes = {
  health: '/health',
  ready: '/ready',
  openapi: '/api/v0/openapi',
  collection: '/api/v0/extensions',
  detail: '/api/v0/extensions/:id',
  register: '/api/v0/extensions/register',
  enable: '/api/v0/extensions/:id/enable',
  disable: '/api/v0/extensions/:id/disable'
} as const
export const mExtensionEventSubjects = {
  definitionRegistered: 'extension.definition.registered.v0',
  definitionRejected: 'extension.definition.rejected.v0',
  instanceEnabled: 'extension.instance.enabled.v0',
  instanceDisabled: 'extension.instance.disabled.v0',
  instanceEnableFailed: 'extension.instance.enable_failed.v0',
  instanceDisableFailed: 'extension.instance.disable_failed.v0'
} as const
export const mExtensionEventTypes = {
  definitionRegistered: 'extension.definition.registered',
  definitionRejected: 'extension.definition.rejected',
  instanceEnabled: 'extension.instance.enabled',
  instanceDisabled: 'extension.instance.disabled',
  instanceEnableFailed: 'extension.instance.enable_failed',
  instanceDisableFailed: 'extension.instance.disable_failed'
} as const

export type MExtensionManifestV01 = {
  id: string
  manifestVersion: MExtensionManifestVersion
  displayName: string
  description?: string | undefined
  kind: MExtensionKind
  owner: string
  license: string
  declaredCapabilities: string[]
  requestedPermissions: Permission[]
  configSchemaRef?: string | undefined
  requestedEvents?: string[] | undefined
  emittedEvents?: string[] | undefined
  riskClass: MExtensionRiskClass
  lifecycleStatus: MExtensionLifecycleStatus
  controlPlaneOnly: true
  futureEntrypoint?: string | undefined
  futureRuntime?: string | undefined
  futureWebhookVerification?: string | undefined
  futureResourceLimits?: Record<string, unknown> | undefined
  createdAt?: string | undefined
  updatedAt?: string | undefined
}

export type MExtensionDefinition = {
  id: string
  manifestVersion: MExtensionManifestVersion
  kind: MExtensionKind
  displayName: string
  owner: string
  license: string
  manifest: MExtensionManifestV01
  declaredCapabilities: string[]
  requestedPermissions: Permission[]
  riskClass: MExtensionRiskClass
  status: MExtensionDefinitionStatus
  registeredBy: ActorId
  policyDecisionId: string
  correlationId: string
  createdAt: string
  updatedAt: string
}

export type MExtensionInstance = {
  id: string
  extensionId: string
  scopeType: MExtensionScopeType
  scopeId: MExtensionScopeId
  status: MExtensionInstanceStatus
  enabledBy?: ActorId | undefined
  disabledBy?: ActorId | undefined
  policyDecisionId?: string | undefined
  correlationId?: string | undefined
  lastError?: string | undefined
  createdAt: string
  updatedAt: string
  enabledAt?: string | undefined
  disabledAt?: string | undefined
}

export type MExtensionTransition = {
  id: string
  extensionId: string
  instanceId?: string | undefined
  fromStatus?: string | undefined
  toStatus: string
  actor: ActorId
  reason?: string | undefined
  policyDecisionId: string
  correlationId: string
  createdAt: string
}

export type RegisterExtensionRequest = {
  manifest: MExtensionManifestV01
  reason?: string | undefined
}

export type EnableExtensionRequest = {
  scopeType?: MExtensionScopeType | undefined
  scopeId?: MExtensionScopeId | undefined
  reason?: string | undefined
}

export type DisableExtensionRequest = EnableExtensionRequest

export type ExtensionListResponse = {
  extensions: Array<{
    definition: MExtensionDefinition
    instance?: MExtensionInstance | undefined
  }>
}

export type ExtensionDetailResponse = {
  definition: MExtensionDefinition
  instance?: MExtensionInstance | undefined
}

export type RegisterExtensionResponse = ExtensionDetailResponse & {
  policyDecisionId: string
  correlationId: string
}

export type ExtensionInstanceControlResponse = {
  definition: MExtensionDefinition
  instance: MExtensionInstance
  policyDecisionId: string
  correlationId: string
}

export type MExtensionEventSubject = typeof mExtensionEventSubjects[keyof typeof mExtensionEventSubjects]

export type MExtensionLifecyclePayload = {
  extensionId: string
  manifestVersion: MExtensionManifestVersion
  kind: MExtensionKind
  actor: ActorId
  decisionId: string
  scopeType: MExtensionScopeType
  scopeId: MExtensionScopeId
  reason?: string | undefined
  correlationId?: string | undefined
  errorCode?: string | undefined
}
