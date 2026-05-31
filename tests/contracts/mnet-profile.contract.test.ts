import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetRegionalProfileSchema,
  NetworkSuspendedOperationSchema,
  SetNetworkProfileRequestSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'

describe('Phase 13 m-net profile contract schemas', () => {
  it('decodes and encodes MNetRegionalProfile for default and cn variants', () => {
    const defaultProfile = {
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
        controlPlaneOnly: true
      }
    } as const

    const cnProfile = {
      profileVersion: 'm-net-cn@0.1.0',
      region: 'cn',
      displayName: 'M-Net CN',
      schemaVersion: 'mnet-profile@0.1.0',
      status: 'available',
      rules: {
        mainlandNodeWithoutPublicAccess: { interconnect: 'tcp_required' }
      },
      capabilities: {
        realDerpRelay: false,
        realTcpInterconnect: false,
        realUdpPathSwitching: false,
        controlPlaneOnly: true
      }
    } as const

    const decodedDefault = Schema.decodeUnknownSync(MNetRegionalProfileSchema)(defaultProfile)
    const decodedCn = Schema.decodeUnknownSync(MNetRegionalProfileSchema)(cnProfile)
    expect(decodedDefault.profileVersion).toBe('m-net-default@0.1.0')
    expect(decodedCn.profileVersion).toBe('m-net-cn@0.1.0')

    const encodedDefault = Schema.encodeSync(MNetRegionalProfileSchema)(decodedDefault)
    const encodedCn = Schema.encodeSync(MNetRegionalProfileSchema)(decodedCn)
    expect(encodedDefault).toEqual(defaultProfile)
    expect(encodedCn).toEqual(cnProfile)
  })

  it('decodes and encodes SetNetworkProfileRequest', () => {
    const request = {
      profileVersion: 'm-net-cn@0.1.0',
      reason: 'regional compliance rollout'
    } as const

    const decoded = Schema.decodeUnknownSync(SetNetworkProfileRequestSchema)(request)
    expect(decoded.profileVersion).toBe('m-net-cn@0.1.0')

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

  it('exports and validates network profile permissions as literal contracts', async () => {
    const { networkProfilePermissions, permissions } = await import('../../packages/contracts/src/literals.ts')

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
