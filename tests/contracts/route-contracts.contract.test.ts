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
  DataPlaneStatusResponseSchema,
  MNetOperationalEventIngestRequestSchema,
  MNetOperationalEventIngestResponseSchema,
  MNetOperationalSnapshotSchema,
  MNetProfileDetailResponseSchema,
  MNetProfileListResponseSchema,
  MNetProfileVersionParamsSchema,
  mNetProfileApiRoutes,
  NetworkMapResponseSchema,
  NetworkNodeRouteParamsSchema,
  NetworkProfileRouteParamsSchema,
  NodeKeyRegistrationResponseSchema,
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
      nodeControl: '/api/v0/nodes/:nodeId/control',
      networkMap: '/api/v0/networks/:id/network-map',
      registerNodeKey: '/api/v0/networks/:id/nodes/:nodeId/key',
      dataPlaneStatus: '/api/v0/networks/:id/dataplane/status',
      operationalState: '/api/v0/networks/:id/operational-state',
      ingestOperationalEvent: '/internal/v0/operational-events',
      resumeOperation: '/internal/v0/network-profile-operations/:id/resume',
      rejectOperation: '/internal/v0/network-profile-operations/:id/reject'
    })
  })

  it('round-trips m-net profile request and response shapes', () => {
    assertRoundTrip(MNetProfileVersionParamsSchema, { profileVersion: 'm-net-cn@0.3.0' })
    assertRoundTrip(NetworkProfileRouteParamsSchema, { id: 'network-1' })
    assertRoundTrip(NetworkNodeRouteParamsSchema, { id: 'network-1', nodeId: 'node-1' })
    assertRoundTrip(MNetProfileListResponseSchema, {
      profiles: [
        {
          profileVersion: 'm-net@0.3.0',
          region: 'default',
          displayName: 'M-Net Default (v0.3)',
          schemaVersion: 'mnet-profile@0.3.0',
          status: 'available',
          rules: {},
          capabilities: {
            controlPlaneOnly: false,
            managementPlaneExcluded: true,
            realNetBirdSidecar: true,
            signalConfigRef: { configRef: 'signal/default' },
            relayConfigRef: { configRef: 'relay/default' },
            stunConfigRef: { configRef: 'stun/default' },
            sidecarDesiredState: 'start',
            sidecarCredentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/sidecar',
              version: 1
            },
            sidecarCredentialStatus: 'ready',
            sidecarHealthStatus: 'healthy'
          }
        },
        {
          profileVersion: 'm-net-cn@0.3.0',
          region: 'cn',
          displayName: 'M-Net CN (v0.3)',
          schemaVersion: 'mnet-profile@0.3.0',
          status: 'available',
          rules: {
            residency: 'cn-only',
            mainlandNodeWithoutPublicAccess: { interconnect: 'netbird_sidecar' }
          },
          capabilities: {
            controlPlaneOnly: false,
            managementPlaneExcluded: true,
            realNetBirdSidecar: true,
            signalConfigRef: { configRef: 'signal/cn-primary' },
            relayConfigRef: { configRef: 'relay/cn-primary' },
            stunConfigRef: { configRef: 'stun/cn-primary' },
            sidecarDesiredState: 'start',
            sidecarCredentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/cn-sidecar',
              version: 1
            },
            sidecarCredentialStatus: 'ready',
            sidecarHealthStatus: 'healthy'
          },
          forcedTcpRelaySelector: {
            enabled: true,
            selectorOwnership: 'policy',
            selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
            routeClass: 'forced-tcp-relay',
            operatorOverrideAllowed: false,
            operatorOverrideActive: false,
            policyDecision: {
              decisionId: 'fixture',
              source: 'm-policy',
              outcome: 'allow',
              reason: 'fixture'
            },
            auditEvidence: {
              auditId: 'fixture',
              eventId: 'fixture',
              eventSubject: 'mnet.forced_relay.change.v0'
            }
          }
        }
      ]
    })
    assertRoundTrip(MNetProfileDetailResponseSchema, {
      profileVersion: 'm-net@0.3.0',
      region: 'default',
      displayName: 'M-Net Default (v0.3)',
      schemaVersion: 'mnet-profile@0.3.0',
      status: 'available',
      rules: {},
      capabilities: {
        controlPlaneOnly: false,
        managementPlaneExcluded: true,
        realNetBirdSidecar: true,
        signalConfigRef: { configRef: 'signal/default' },
        relayConfigRef: { configRef: 'relay/default' },
        stunConfigRef: { configRef: 'stun/default' },
        sidecarDesiredState: 'start',
        sidecarCredentialRef: {
          provider: 'vault-kv-v2',
          keyPath: 'secret/data/mnet/sidecar',
          version: 1
        },
        sidecarCredentialStatus: 'ready',
        sidecarHealthStatus: 'healthy'
      }
    })
    assertRoundTrip(SetNetworkProfileRequestSchema, {
      profileVersion: 'm-net-cn@0.3.0',
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
      profileVersion: 'm-net@0.3.0',
      correlationId: 'corr-2'
    })
    assertRoundTrip(SetNetworkProfileResponseSchema, {
      status: 'activated',
      profileVersion: 'm-net-cn@0.3.0',
      operationId: 'op-dataplane-1',
      networkMap: { networkId: 'network-1', mapVersion: 'map-1' },
      dataPlaneActivationStatus: 'active',
      correlationId: 'corr-3'
    })
    assertRoundTrip(NetworkMapResponseSchema, {
      networkId: 'network-1',
      mapVersion: 'map-1',
      members: [
        {
          nodeId: 'node-1',
          tunnelIp: '100.64.0.10',
          publicKeyFingerprint: 'wg-fp-node-1'
        }
      ],
      relayAssignment: {
        relayType: 'wstunnel',
        relayEndpoint: 'wss://relay.cn.example/mnet',
        nodeIds: ['node-1']
      },
      aclRules: [
        {
          ruleId: 'acl-1',
          action: 'allow',
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2',
          protocol: 'any'
        }
      ],
      expiresAt: '2026-06-04T10:05:00.000Z',
      signedBy: 'm-net-cn-control'
    })
    assertRoundTrip(NodeKeyRegistrationResponseSchema, {
      nodeId: 'node-1',
      keyFingerprint: 'wg-fp-node-1',
      keyMetadata: {
        algorithm: 'wireguard-x25519',
        issuedAt: '2026-06-04T10:00:00.000Z',
        rotationCounter: 1,
        publicKeyFingerprint: 'wg-fp-node-1'
      },
      expiresAt: '2026-06-05T10:00:00.000Z'
    })
    assertRoundTrip(DataPlaneStatusResponseSchema, {
      networkId: 'network-1',
      nodeId: 'node-1',
      tunnelStatus: 'up',
      relayAssignment: {
        nodeId: 'node-1',
        relayEndpoint: 'wss://relay.cn.example/mnet',
        relayType: 'wstunnel'
      },
      lastMapVersion: 'map-1',
      lastMapAt: '2026-06-04T10:00:00.000Z',
      partitionState: 'connected'
    })
    assertRoundTrip(MNetOperationalEventIngestRequestSchema, {
      networkId: 'net-v03',
      eventId: 'evt-1',
      occurredAt: '2026-06-30T10:00:00.000Z',
      event: {
        subject: 'mnet.sidecar.health.v0',
        payload: {
          networkId: 'net-v03',
          nodeId: 'node-v03-1',
          profileVersion: 'm-net@0.3.0',
          healthStatus: 'healthy',
          previousHealthStatus: 'unknown',
          signalReachable: true,
          relayReachable: true,
          stunReachable: true,
          checkedAt: '2026-06-30T10:00:00.000Z',
          correlationId: 'corr-sidecar-health-1'
        }
      }
    })
    assertRoundTrip(MNetOperationalEventIngestResponseSchema, {
      accepted: true,
      networkId: 'net-v03',
      publishStatus: 'published',
      snapshotStatus: 'healthy',
      occurredAt: '2026-06-30T10:00:00.000Z'
    })
    assertRoundTrip(MNetOperationalSnapshotSchema, {
      networkId: 'net-v03',
      network: {
        status: 'active',
        memberCount: 1,
        profileState: 'enabled',
        lastUpdatedAt: '2026-06-30T10:00:00.000Z',
        summary: '1 nodes tracked in the operational read model'
      },
      profileSelection: {
        profileVersion: 'm-net@0.3.0',
        displayName: 'M-Net NetBird',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'default',
        controlPlaneOnly: false,
        compatibility: 'compatible'
      },
      eventStream: { status: 'healthy' },
      sidecars: [],
      topology: {
        nodes: [],
        edges: [],
        summary: 'Topology is waiting for the first relay or peer update'
      },
      credentials: {
        status: 'healthy',
        nodes: [],
        summary: 'Current profile does not require sidecar credentials'
      },
      migrationRequired: {
        required: false,
        summary: 'No migration is required'
      },
      forcedRelay: {
        active: false,
        affectedNodeIds: [],
        summary: 'Forced relay is not active'
      },
      deploymentReadiness: {
        status: 'healthy',
        summary: 'Deployment is ready',
        reasons: []
      },
      stateSources: {
        network: 'authoritative',
        profileSelection: 'authoritative',
        sidecars: 'read-model',
        topology: 'read-model',
        credentials: 'read-model',
        migration: 'read-model',
        forcedRelay: 'read-model',
        deploymentReadiness: 'composed',
        eventStream: 'read-model'
      }
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
