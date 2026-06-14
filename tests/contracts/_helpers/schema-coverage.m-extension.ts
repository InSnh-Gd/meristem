import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const mExtensionEventContracts: EventContract[] = [
  'extension.definition.registered.v0',
  'extension.definition.rejected.v0',
  'extension.instance.enabled.v0',
  'extension.instance.disabled.v0',
  'extension.instance.enable_failed.v0',
  'extension.instance.disable_failed.v0'
].map(subject => ({
  subject,
  schema: Contracts.MExtensionLifecyclePayloadSchema,
  fixture: {
    extensionId: 'ext-1',
    manifestVersion: 'm-extension-manifest@0.1.0',
    kind: 'metadata-only',
    actor: 'admin',
    decisionId: 'pd-ext-1',
    scopeType: 'system',
    scopeId: 'default',
    reason: 'operator request',
    correlationId: 'corr-ext-1',
    ...(subject.includes('failed') || subject.includes('rejected')
      ? { errorCode: 'extension.publish_failed' }
      : {})
  }
}))

const extensionDefinition = {
  id: 'ext-1',
  manifestVersion: 'm-extension-manifest@0.1.0',
  kind: 'metadata-only',
  displayName: 'Demo Extension',
  owner: 'team-meristem',
  license: 'Apache-2.0',
  manifest: {
    id: 'ext-1',
    manifestVersion: 'm-extension-manifest@0.1.0',
    displayName: 'Demo Extension',
    kind: 'metadata-only',
    owner: 'team-meristem',
    license: 'Apache-2.0',
    declaredCapabilities: [],
    requestedPermissions: [],
    riskClass: 'low',
    lifecycleStatus: 'active',
    controlPlaneOnly: true
  },
  declaredCapabilities: [],
  requestedPermissions: [],
  riskClass: 'low',
  status: 'registered',
  registeredBy: 'admin',
  policyDecisionId: 'pd-ext',
  correlationId: 'corr-ext',
  createdAt: '2026-06-04T10:00:00.000Z',
  updatedAt: '2026-06-04T10:00:00.000Z'
}

export const mExtensionResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/extensions',
    schema: Contracts.ExtensionListResponseSchema,
    fixture: { extensions: [{ definition: extensionDefinition }] }
  },
  {
    route: 'GET /api/v0/extensions/:id',
    schema: Contracts.ExtensionDetailResponseSchema,
    fixture: { definition: extensionDefinition }
  },
  {
    route: 'POST /api/v0/extensions/register',
    schema: Contracts.RegisterExtensionResponseSchema,
    fixture: {
      definition: extensionDefinition,
      policyDecisionId: 'pd-ext',
      correlationId: 'corr-ext'
    }
  },
  {
    route: 'POST /api/v0/extensions/:id/enable',
    schema: Contracts.ExtensionInstanceControlResponseSchema,
    fixture: {
      definition: extensionDefinition,
      instance: {
        id: 'inst-1',
        extensionId: 'ext-1',
        scopeType: 'system',
        scopeId: 'default',
        status: 'enabled',
        enabledBy: 'admin',
        policyDecisionId: 'pd-ext',
        correlationId: 'corr-ext',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:05:00.000Z',
        enabledAt: '2026-06-04T10:05:00.000Z'
      },
      policyDecisionId: 'pd-ext',
      correlationId: 'corr-ext'
    }
  }
]
