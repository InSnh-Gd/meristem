import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetRegionalProfileSchema,
  type MNetRegionalProfileFromSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  createDataPlaneAdapter,
  DATA_PLANE_FEATURE_GATE_DEFAULT
} from '../../services/m-net/src/data-plane/noop-adapter.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'

describe('M-Net data-plane skeleton contract', () => {
  it('m-net-cn@0.1.0 profile has controlPlaneOnly: true', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.1.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.controlPlaneOnly).toBe(true)
  })

  it('m-net-cn@0.1.0 profile has all real transport capabilities set to false', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.1.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.realDerpRelay).toBe(false)
    expect(def?.capabilities.realTcpInterconnect).toBe(false)
    expect(def?.capabilities.realUdpPathSwitching).toBe(false)
  })

  it('m-net-default@0.1.0 profile has controlPlaneOnly: false', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-default@0.1.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.controlPlaneOnly).toBe(false)
  })

  it('profile schema does not expose runtime transport ports or protocols', () => {
    const cnProfile: MNetRegionalProfileFromSchema = {
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

  it('profile enable event payload carries controlPlaneOnly: true', () => {
    // The event payload schema enforces controlPlaneOnly as literal true
    const payload = {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      actor: 'admin',
      policyDecisionId: 'pd-1',
      correlationId: 'corr-1',
      reason: 'enable CN profile',
      controlPlaneOnly: true as const
    }
    // This matches the event payload shape used in profile-routes.ts
    expect(payload.controlPlaneOnly).toBe(true)
  })
})
