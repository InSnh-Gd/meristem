import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetHistoricalProfileVersionSchema,
  MNetRegionalProfileSchema,
  NetworkSuspendedOperationSchema,
  SetNetworkProfileRequestSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import { decodeMNetProfileV03Compatibility } from '../../packages/contracts/src/schemas/mnet-profile-v03.ts'

describe('M-Net profile contract schemas', () => {
  it('decodes and encodes MNetRegionalProfile for default and cn variants', () => {
    const defaultProfile = {
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
    } as const

    const cnProfile = {
      profileVersion: 'm-net-cn@0.3.0',
      region: 'cn',
      displayName: 'M-Net CN (v0.3)',
      schemaVersion: 'mnet-profile@0.3.0',
      status: 'available',
      rules: {
        mainlandNodeWithoutPublicAccess: { interconnect: 'netbird_sidecar' },
        residency: 'cn-only'
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
    } as const

    const decodedDefault = Schema.decodeUnknownSync(MNetRegionalProfileSchema)(defaultProfile)
    const decodedCn = Schema.decodeUnknownSync(MNetRegionalProfileSchema)(cnProfile)
    expect(decodedDefault.profileVersion).toBe('m-net@0.3.0')
    expect(decodedCn.profileVersion).toBe('m-net-cn@0.3.0')

    const encodedDefault = Schema.encodeSync(MNetRegionalProfileSchema)(decodedDefault)
    const encodedCn = Schema.encodeSync(MNetRegionalProfileSchema)(decodedCn)
    expect(encodedDefault).toEqual(defaultProfile)
    expect(encodedCn).toEqual(cnProfile)
  })

  it('classifies legacy profiles as migration_required compatibility results', () => {
    const result = decodeMNetProfileV03Compatibility({
      profileVersion: 'm-net-cn@0.2.0',
      displayName: 'Legacy CN profile'
    })

    expect(result.kind).toBe('migration_required')
    if (result.kind !== 'migration_required') throw new Error('expected migration_required')
    expect(result.migration.targetProfileVersion).toBe('m-net-cn@0.3.0')
  })

  it('decodes and encodes SetNetworkProfileRequest', () => {
    const request = {
      profileVersion: 'm-net-cn@0.3.0',
      reason: 'regional compliance rollout'
    } as const

    const decoded = Schema.decodeUnknownSync(SetNetworkProfileRequestSchema)(request)
    expect(decoded.profileVersion).toBe('m-net-cn@0.3.0')

    const encoded = Schema.encodeSync(SetNetworkProfileRequestSchema)(decoded)
    expect(encoded).toEqual(request)
  })

  it('decodes and encodes NetworkSuspendedOperation for profile enable approval', () => {
    const now = new Date().toISOString()
    const operation = {
      id: 'op-mnet-1',
      policyDecisionId: 'pd-mnet-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN profile for target network',
      correlationId: 'corr-mnet-1',
      idempotencyKey: 'idem-mnet-1',
      status: 'suspended',
      expiresAt: now,
      createdAt: now
    } as const

    const decoded = Schema.decodeUnknownSync(NetworkSuspendedOperationSchema)(operation)
    expect(decoded.action).toBe('mnet.profile.enable')
    expect(decoded.toProfileVersion).toBe('m-net-cn@0.1.0')

    const encoded = Schema.encodeSync(NetworkSuspendedOperationSchema)(decoded)
    expect(encoded).toEqual(operation)
  })

  it('keeps historical versions decodable for migration metadata', () => {
    expect(Schema.decodeUnknownSync(MNetHistoricalProfileVersionSchema)('m-net-cn@0.1.0')).toBe(
      'm-net-cn@0.1.0'
    )
    expect(Schema.decodeUnknownSync(MNetHistoricalProfileVersionSchema)('m-net-cn@0.2.0')).toBe(
      'm-net-cn@0.2.0'
    )
  })

  it('exports and validates network profile permissions as literal contracts', async () => {
    const { networkProfilePermissions, permissions } = await import(
      '../../packages/contracts/src/literals.ts'
    )

    expect(networkProfilePermissions).toEqual([
      'network:profile-read',
      'network:profile-enable',
      'network:profile-disable'
    ])
    for (const permission of networkProfilePermissions) {
      expect(permissions).toContain(permission)
    }
  })
})
