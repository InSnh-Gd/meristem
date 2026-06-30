import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetHistoricalProfileVersionSchema,
  type MNetRegionalProfileFromSchema,
  MNetRegionalProfileSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  createDataPlaneAdapter,
  DATA_PLANE_FEATURE_GATE_DEFAULT
} from '../../services/m-net/src/data-plane/noop-adapter.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { decodeMNetProfileV03Compatibility } from '../../packages/contracts/src/schemas/mnet-profile-v03.ts'

describe('M-Net data-plane skeleton contract', () => {
  it('legacy m-net-cn@0.1.0 profile is rejected through migration guidance', async () => {
    const compatibility = decodeMNetProfileV03Compatibility({ profileVersion: 'm-net-cn@0.1.0' })
    expect(compatibility.kind).toBe('migration_required')
    if (compatibility.kind !== 'migration_required') throw new Error('expected migration_required')
    expect(compatibility.migration.targetProfileVersion).toBe('m-net-cn@0.3.0')
  })

  it('m-net-cn@0.3.0 profile has NetBird sidecar enabled', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.3.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.controlPlaneOnly).toBe(false)
    expect(def?.capabilities.realNetBirdSidecar).toBe(true)
  })

  it('m-net-cn@0.3.0 profile exposes sidecar config refs instead of legacy transport flags', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.3.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.signalConfigRef).toEqual({ configRef: 'signal/cn-primary' })
    expect(def?.capabilities.relayConfigRef).toEqual({ configRef: 'relay/cn-primary' })
    expect(def?.capabilities.stunConfigRef).toEqual({ configRef: 'stun/cn-primary' })
  })

  it('m-net@0.3.0 profile has controlPlaneOnly: false', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net@0.3.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.controlPlaneOnly).toBe(false)
  })

  it('profile schema does not expose runtime transport ports or protocols', () => {
    const cnProfile: MNetRegionalProfileFromSchema = {
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
    }

    const decoded = Schema.decodeUnknownSync(MNetRegionalProfileSchema)(cnProfile)
    // Schema shape must not contain port, endpoint, transport, or secret fields
    const keys = Object.keys(decoded)
    expect(keys).not.toContain('endpoints')
    expect(keys).not.toContain('ports')
    expect(keys).not.toContain('transport')
    expect(keys).not.toContain('secrets')
    expect(keys).not.toContain('relays')
    expect(keys).not.toContain('probes')
  })

  it('data-plane feature flag is off by default', () => {
    expect(DATA_PLANE_FEATURE_GATE_DEFAULT).toBe(false)
  })

  it('noop adapter returns disabled noop when gate is off', () => {
    const adapter = createDataPlaneAdapter({ enabled: false })
    expect(adapter.enabled).toBe(false)
    expect(adapter.status).toBe('noop')
  })

  it('noop adapter returns disabled noop even when gate is on (skeleton)', () => {
    const adapter = createDataPlaneAdapter({ enabled: true })
    expect(adapter.enabled).toBe(false)
    expect(adapter.status).toBe('noop')
  })

  it('historical profile versions remain decodable for migration metadata', () => {
    expect(Schema.decodeUnknownSync(MNetHistoricalProfileVersionSchema)('m-net-default@0.1.0')).toBe(
      'm-net-default@0.1.0'
    )
    expect(Schema.decodeUnknownSync(MNetHistoricalProfileVersionSchema)('m-net-cn@0.2.0')).toBe(
      'm-net-cn@0.2.0'
    )
  })
})
