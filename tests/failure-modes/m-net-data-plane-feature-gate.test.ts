import { describe, expect, it } from 'bun:test'
import {
  createDataPlaneAdapter,
  DATA_PLANE_FEATURE_GATE_DEFAULT
} from '../../services/m-net/src/data-plane/noop-adapter.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'

describe('M-Net data-plane feature gate failure modes', () => {
  it('feature flag default denies runtime path changes', () => {
    expect(DATA_PLANE_FEATURE_GATE_DEFAULT).toBe(false)
    const adapter = createDataPlaneAdapter({ enabled: DATA_PLANE_FEATURE_GATE_DEFAULT })
    expect(adapter.enabled).toBe(false)
    expect(adapter.status).toBe('noop')
  })

  it('noop adapter reports deferred/noop status when gate is off', () => {
    const adapter = createDataPlaneAdapter({ enabled: false })
    expect(adapter.status).toBe('noop')
    expect(adapter.enabled).toBe(false)
  })

  it('noop adapter reports noop status even when gate is on (no real transport)', () => {
    const adapter = createDataPlaneAdapter({ enabled: true })
    expect(adapter.status).toBe('noop')
    expect(adapter.enabled).toBe(false)
  })

  it('cannot mutate runtime transport paths when gate is off', () => {
    const adapter = createDataPlaneAdapter({ enabled: false })
    // The adapter result has no methods or fields that could mutate transport
    expect(adapter).toEqual({ enabled: false, status: 'noop' })
    // No transport, endpoints, or port fields exist on the result
    expect(Object.keys(adapter)).toEqual(['enabled', 'status'])
  })

  it('m-net-cn@0.1.0 remains controlPlaneOnly regardless of adapter state', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.1.0')
    expect(def).not.toBeNull()
    expect(def?.capabilities.controlPlaneOnly).toBe(true)
    expect(def?.capabilities.realDerpRelay).toBe(false)
    expect(def?.capabilities.realTcpInterconnect).toBe(false)
    expect(def?.capabilities.realUdpPathSwitching).toBe(false)
  })

  it('noop adapter does not expose endpoint or port fields', () => {
    const adapterOff = createDataPlaneAdapter({ enabled: false })
    const adapterOn = createDataPlaneAdapter({ enabled: true })
    for (const adapter of [adapterOff, adapterOn]) {
      expect(adapter).not.toHaveProperty('endpoints')
      expect(adapter).not.toHaveProperty('ports')
      expect(adapter).not.toHaveProperty('transport')
      expect(adapter).not.toHaveProperty('derpRelay')
      expect(adapter).not.toHaveProperty('tcpInterconnect')
      expect(adapter).not.toHaveProperty('udpPathSwitching')
    }
  })

  it('profile store CN definition has no real endpoint data', async () => {
    const store = createInMemoryProfileStore()
    const def = await store.getDefinition('m-net-cn@0.1.0')
    expect(def).not.toBeNull()
    // Profile must not contain endpoint, secret, relay, route, or probe data
    const profileKeys = Object.keys(def ?? {})
    expect(profileKeys).not.toContain('endpoints')
    expect(profileKeys).not.toContain('secrets')
    expect(profileKeys).not.toContain('relays')
    expect(profileKeys).not.toContain('routes')
    expect(profileKeys).not.toContain('probes')
  })
})
