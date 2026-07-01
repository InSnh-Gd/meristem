import { describe, expect, it } from 'bun:test'
import type { NetBirdResolvedControlPlaneConfig } from '../../services/m-net/src/netbird-adapter.ts'
import { createNetBirdAdapter } from '../../services/m-net/src/netbird-adapter.ts'
import { selectDataPlaneAdapter } from '../../services/m-net/src/mnet-dataplane-workflows.ts'

const resolvedControlPlane: NetBirdResolvedControlPlaneConfig = {
  managementUrl: 'https://netbird.example.internal',
  setupKey: 'nb-setup-key-from-secret-provider',
  signalConfigRef: { configRef: 'signal/cn-primary' },
  relayConfigRef: { configRef: 'relay/cn-primary' },
  stunConfigRef: { configRef: 'stun/cn-primary' },
  sidecarCredentialRef: {
    provider: 'vault-kv-v2',
    keyPath: 'secret/data/mnet/cn-sidecar',
    version: 1
  },
  prerequisites: {
    signalReady: true,
    relayReady: true,
    stunReady: true
  }
}

describe('M-Net NetBird adapter contract', () => {
  it('selects NetBird for v0.3 profile by default', () => {
    const adapter = selectDataPlaneAdapter({
      profileVersion: 'm-net@0.3.0',
      netbirdControlPlane: resolvedControlPlane
    })

    expect(adapter.enabled).toBe(true)
    expect(adapter.status).toBe('enabled')
    if (!adapter.enabled) throw new Error('expected NetBird adapter')
    expect(adapter.transport).toBe('netbird-sidecar')
  })

  it('produces node-agent desired state from SecretProvider-resolved config', () => {
    const adapter = createNetBirdAdapter({
      profileVersion: 'm-net-cn@0.3.0',
      controlPlane: resolvedControlPlane
    })

    expect(adapter.enabled).toBe(true)
    if (!adapter.enabled) throw new Error('expected enabled adapter')
    expect(adapter.desiredState).toMatchObject({
      signalConfigRef: { configRef: 'signal/cn-primary' },
      relayConfigRef: { configRef: 'relay/cn-primary' },
      stunConfigRef: { configRef: 'stun/cn-primary' },
      sidecarCredentialRef: {
        provider: 'vault-kv-v2',
        keyPath: 'secret/data/mnet/cn-sidecar',
        version: 1
      },
      desiredState: 'start',
      credentialStatus: 'ready',
      healthStatus: 'healthy'
    })
    expect(typeof adapter.desiredState.configHash).toBe('string')
    if (typeof adapter.desiredState.configHash !== 'string') {
      throw new Error('expected configHash')
    }
    expect(adapter.desiredState.configHash).toMatch(/^[a-f0-9]{64}$/)
    expect(adapter.clientConfig.configHash).toBe(adapter.desiredState.configHash)
  })

  it('rejects NetBird Management, Dashboard, and ACL fields with a typed error', () => {
    const adapter = createNetBirdAdapter({
      profileVersion: 'm-net-cn@0.3.0',
      controlPlane: {
        ...resolvedControlPlane,
        management: { peerProvisioning: true },
        dashboard: { enabled: true },
        acl: [{ action: 'allow' }]
      }
    })

    expect(adapter.enabled).toBe(false)
    if (adapter.enabled) throw new Error('expected rejected adapter')
    expect(adapter.status).toBe('rejected')
    expect(adapter.error.code).toBe('netbird.config.forbidden_management_plane')
    expect(adapter.error.fields).toEqual(['management', 'dashboard', 'acl'])
  })

  it('consumes externally provisioned setup key without API provisioning fields', () => {
    const adapter = createNetBirdAdapter({
      profileVersion: 'm-net@0.3.0',
      controlPlane: resolvedControlPlane
    })

    expect(adapter.enabled).toBe(true)
    if (!adapter.enabled) throw new Error('expected enabled adapter')
    expect(adapter.clientConfig.setupKey).toBe('nb-setup-key-from-secret-provider')
    expect(adapter.clientConfig).not.toHaveProperty('managementApiToken')
    expect(adapter.clientConfig).not.toHaveProperty('peerProvisioning')
    expect(adapter.clientConfig).not.toHaveProperty('aclRules')
  })

  it('selects noop only for explicit disabled or local fallback mode', () => {
    const disabled = selectDataPlaneAdapter({
      profileVersion: 'm-net-cn@0.3.0',
      fallbackMode: 'disabled',
      netbirdControlPlane: resolvedControlPlane
    })
    const local = selectDataPlaneAdapter({
      profileVersion: 'm-net@0.3.0',
      fallbackMode: 'local',
      netbirdControlPlane: resolvedControlPlane
    })

    expect(disabled).toEqual({ enabled: false, status: 'noop', mode: 'disabled' })
    expect(local).toEqual({ enabled: false, status: 'noop', mode: 'local' })
  })
})
