import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  ConfigApplyAckRequestSchema,
  ConfigApplyAckResponseSchema,
  ConfigDraftRequestSchema,
  ConfigDraftResponseSchema,
  ConfigPublishRequestSchema,
  ConfigPublishResponseSchema,
  ConfigRollbackRequestSchema,
  ConfigRollbackResponseSchema,
  ConfigRouteParamsSchema,
  ConfigValidateResponseSchema,
  configApiRoutes,
  MNetProfileDetailResponseSchema,
  MNetProfileListResponseSchema,
  MNetProfileVersionParamsSchema,
  mNetProfileApiRoutes,
  NetworkProfileRouteParamsSchema,
  SecretCreateRequestSchema,
  SecretCreateResponseSchema,
  SecretDetailResponseSchema,
  SecretDisableRequestSchema,
  SecretDisableResponseSchema,
  SecretListResponseSchema,
  SecretReferenceResponseSchema,
  SecretRotateRequestSchema,
  SecretRotateResponseSchema,
  SecretRouteParamsSchema,
  SetNetworkProfileRequestSchema,
  SetNetworkProfileResponseSchema,
  secretApiRoutes
} from '../../packages/contracts/src/index.ts'

function assertRoundTrip<TSchema extends Schema.Schema.AnyNoContext>(
  schema: TSchema,
  fixture: typeof schema.Type
) {
  const encoded = Schema.encodeSync(schema)(fixture)
  const decoded = Schema.decodeUnknownSync(schema)(encoded)
  expect(decoded).toEqual(fixture)
}

describe('config route contracts', () => {
  it('exports canonical config routes', () => {
    expect(configApiRoutes).toEqual({
      collection: '/api/v0/configs',
      detail: '/api/v0/configs/:id',
      drafts: '/api/v0/configs/drafts',
      validate: '/api/v0/configs/:id/validate',
      publish: '/api/v0/configs/:id/publish',
      rollback: '/api/v0/configs/:id/rollback',
      applyAck: '/internal/v0/configs/:id/apply-ack'
    })
  })

  it('round-trips config request and response shapes', () => {
    assertRoundTrip(ConfigRouteParamsSchema, { id: 'cfg-1' })
    assertRoundTrip(ConfigDraftRequestSchema, {
      domain: 'm-net',
      payload: { featureFlag: true, replicaCount: 2 },
      targetScope: ['network-a']
    })
    assertRoundTrip(ConfigDraftResponseSchema, {
      config: {
        id: 'cfg-1',
        configVersion: 'cfgv-1',
        status: 'draft',
        createdAt: '2026-06-04T10:00:00.000Z'
      }
    })
    assertRoundTrip(ConfigPublishRequestSchema, { reason: 'promote validated config' })
    assertRoundTrip(ConfigPublishResponseSchema, {
      config: {
        id: 'cfg-1',
        configVersion: 'cfgv-1',
        status: 'published',
        publishedAt: '2026-06-04T10:05:00.000Z',
        publishedBy: 'admin'
      }
    })
    assertRoundTrip(ConfigRollbackRequestSchema, {
      toVersion: 'cfgv-0',
      reason: 'rollback after failed apply'
    })
    assertRoundTrip(ConfigRollbackResponseSchema, {
      config: { id: 'cfg-1', status: 'rolled_back' }
    })
    assertRoundTrip(ConfigApplyAckRequestSchema, {
      configVersion: 'cfgv-1',
      ackedBy: 'm-net',
      status: 'failed',
      errorCode: 'apply.timeout',
      errorMessage: 'apply timed out'
    })
    assertRoundTrip(ConfigApplyAckResponseSchema, {
      ack: {
        ackId: 'ack-1',
        configId: 'cfg-1',
        configVersion: 'cfgv-1',
        ackedBy: 'm-net',
        status: 'failed',
        ackedAt: '2026-06-04T10:06:00.000Z',
        errorCode: 'apply.timeout',
        errorMessage: 'apply timed out'
      }
    })
    assertRoundTrip(ConfigValidateResponseSchema, {
      config: { id: 'cfg-1', status: 'validated' }
    })
  })

  it('rejects unsupported config apply-ack status', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigApplyAckRequestSchema)({
        version: 'cfgv-1',
        targetService: 'm-net',
        status: 'pending'
      })
    ).toThrow()
  })
})

describe('secret route contracts', () => {
  it('exports canonical secret routes', () => {
    expect(secretApiRoutes).toEqual({
      collection: '/api/v0/secrets',
      detail: '/api/v0/secrets/:id',
      create: '/api/v0/secrets',
      rotate: '/api/v0/secrets/:id/rotate',
      disable: '/api/v0/secrets/:id/disable',
      reference: '/internal/v0/secrets/:id/reference'
    })
  })

  it('round-trips secret request and response shapes', () => {
    assertRoundTrip(SecretRouteParamsSchema, { id: 'secret-1' })
    assertRoundTrip(SecretCreateRequestSchema, {
      name: 'api-key-prod',
      scope: 'service',
      value: 'secret-value',
      metadata: { env: 'prod' }
    })
    assertRoundTrip(SecretListResponseSchema, [
      {
        id: 'secret-1',
        name: 'api-key-prod',
        scope: 'service',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-04T10:00:00.000Z',
        metadata: { env: 'prod' }
      }
    ])
    assertRoundTrip(SecretDetailResponseSchema, {
      id: 'secret-1',
      name: 'api-key-prod',
      scope: 'service',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-04T10:00:00.000Z',
      metadata: { env: 'prod' },
      updatedAt: '2026-06-04T10:01:00.000Z'
    })
    assertRoundTrip(SecretCreateResponseSchema, {
      id: 'secret-1',
      name: 'api-key-prod',
      status: 'active',
      createdAt: '2026-06-04T10:00:00.000Z'
    })
    assertRoundTrip(SecretRotateRequestSchema, { value: 'next-secret', reason: 'routine rotation' })
    assertRoundTrip(SecretRotateResponseSchema, {
      id: 'secret-1',
      version: '2',
      status: 'rotated',
      rotatedAt: '2026-06-04T11:00:00.000Z'
    })
    assertRoundTrip(SecretDisableRequestSchema, { reason: 'service retired' })
    assertRoundTrip(SecretDisableResponseSchema, {
      id: 'secret-1',
      status: 'disabled',
      disabledAt: '2026-06-04T12:00:00.000Z'
    })
    assertRoundTrip(SecretReferenceResponseSchema, {
      id: 'secret-1',
      currentVersion: '2',
      status: 'active',
      metadata: { env: 'prod' }
    })
  })

  it('rejects secret create requests without a valid scope', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretCreateRequestSchema)({
        name: 'api-key-prod',
        scope: 'cluster',
        value: 'secret-value'
      })
    ).toThrow()
  })
})

describe('m-net profile route contracts', () => {
  it('exports canonical m-net profile routes', () => {
    expect(mNetProfileApiRoutes).toEqual({
      collection: '/api/v0/network-profiles',
      detail: '/api/v0/network-profiles/:profileVersion',
      setNetworkProfile: '/api/v0/networks/:id/profile',
      resumeOperation: '/internal/v0/network-profile-operations/:id/resume',
      rejectOperation: '/internal/v0/network-profile-operations/:id/reject'
    })
  })

  it('round-trips m-net profile request and response shapes', () => {
    assertRoundTrip(MNetProfileVersionParamsSchema, { profileVersion: 'm-net-cn@0.1.0' })
    assertRoundTrip(NetworkProfileRouteParamsSchema, { id: 'network-1' })
    assertRoundTrip(MNetProfileListResponseSchema, {
      profiles: [
        {
          profileVersion: 'm-net-cn@0.1.0',
          region: 'cn',
          displayName: 'M-Net CN',
          schemaVersion: 'mnet-profile@0.1.0',
          status: 'available',
          rules: { residency: 'cn-only' },
          capabilities: {
            realDerpRelay: false,
            realTcpInterconnect: false,
            realUdpPathSwitching: false,
            controlPlaneOnly: true
          }
        }
      ]
    })
    assertRoundTrip(MNetProfileDetailResponseSchema, {
      profileVersion: 'm-net-default@0.1.0',
      region: 'default',
      displayName: 'M-Net Default',
      schemaVersion: 'mnet-profile@0.1.0',
      status: 'available',
      rules: {},
      capabilities: {
        realDerpRelay: false,
        realTcpInterconnect: false,
        realUdpPathSwitching: false,
        controlPlaneOnly: false
      }
    })
    assertRoundTrip(SetNetworkProfileRequestSchema, {
      profileVersion: 'm-net-cn@0.1.0',
      reason: 'enable CN profile for compliance'
    })
    assertRoundTrip(SetNetworkProfileResponseSchema, {
      status: 'pending_approval',
      operationId: 'op-1',
      approvalId: 'approval-1',
      correlationId: 'corr-1'
    })
    assertRoundTrip(SetNetworkProfileResponseSchema, {
      status: 'disabled',
      profileVersion: 'm-net-default@0.1.0',
      correlationId: 'corr-2'
    })
  })

  it('rejects unsupported network profile versions', () => {
    expect(() =>
      Schema.decodeUnknownSync(SetNetworkProfileRequestSchema)({
        profileVersion: 'm-net-eu@0.1.0',
        reason: 'unsupported region'
      })
    ).toThrow()
  })
})
