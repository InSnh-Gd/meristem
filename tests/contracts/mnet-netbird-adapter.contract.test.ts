import { describe, expect, it } from 'bun:test'
import {
  createNetbirdAdapter,
  NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY,
  parseNetbirdStatusOutput
} from '@m-net/data-plane/netbird-adapter.ts'

const STATUS_JSON = JSON.stringify({
  ManagementState: { Connected: false },
  SignalState: { Connected: true },
  RelayState: { Connected: true, URI: 'rels://relay.example:443' },
  Peers: [{}, {}, {}]
})

const FIXTURE_BINARY = 'netbird-test-fixture'

describe('M-Net netbird adapter noop boundary', () => {
  it('returns noop result when the feature gate is closed', async () => {
    const adapter = createNetbirdAdapter({ enabled: false }, { clientBinary: FIXTURE_BINARY })
    const outcome = await adapter.probeRuntime()
    expect(outcome).toEqual({
      enabled: false,
      status: 'noop',
      runtimeTransport: 'not_implemented'
    })
  })

  it('stays noop when gate is open but no client binary is configured', async () => {
    const previous = process.env.MERISTEM_NETBIRD_CLIENT_BINARY
    delete process.env.MERISTEM_NETBIRD_CLIENT_BINARY
    try {
      const adapter = createNetbirdAdapter({ enabled: true })
      const outcome = await adapter.probeRuntime()
      expect(outcome).toEqual({
        enabled: false,
        status: 'noop',
        runtimeTransport: 'not_implemented'
      })
    } finally {
      if (previous !== undefined) process.env.MERISTEM_NETBIRD_CLIENT_BINARY = previous
    }
  })
})

describe('M-Net netbird adapter runtime probe', () => {
  it('reports sidecar running state without management dependency', async () => {
    const adapter = createNetbirdAdapter(
      { enabled: true },
      {
        clientBinary: FIXTURE_BINARY,
        runStatusCommand: async () => ({ exitCode: 0, stdout: STATUS_JSON }),
        now: () => new Date('2026-09-07T00:00:00.000Z')
      }
    )
    const outcome = await adapter.probeRuntime()
    expect(outcome).toEqual({
      enabled: true,
      status: 'sidecar_running',
      runtimeTransport: 'netbird_sidecar',
      runtime: {
        signalConnected: true,
        relayConnected: true,
        managementConnected: false,
        peerCount: 3
      },
      probedAt: '2026-09-07T00:00:00.000Z'
    })
  })

  it('returns the typed management dependency outcome when client uses NetBird Management', async () => {
    const adapter = createNetbirdAdapter(
      { enabled: true },
      {
        clientBinary: FIXTURE_BINARY,
        runStatusCommand: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            ManagementState: { Connected: true },
            SignalState: { Connected: true }
          })
        })
      }
    )
    const outcome = await adapter.probeRuntime()
    expect(outcome).toMatchObject({ code: NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY })
  })

  it('reports reachable failure on nonzero exit so callers may retry', async () => {
    const adapter = createNetbirdAdapter(
      { enabled: true },
      {
        clientBinary: FIXTURE_BINARY,
        runStatusCommand: async () => ({ exitCode: 1, stdout: '' })
      }
    )
    const outcome = await adapter.probeRuntime()
    expect(outcome).toMatchObject({
      enabled: false,
      status: 'sidecar_unreachable',
      runtimeTransport: 'netbird_sidecar'
    })
  })

  it('reports reachable failure on unparsable status output', async () => {
    const adapter = createNetbirdAdapter(
      { enabled: true },
      {
        clientBinary: FIXTURE_BINARY,
        runStatusCommand: async () => ({ exitCode: 0, stdout: 'not-json' })
      }
    )
    const outcome = await adapter.probeRuntime()
    expect(outcome).toMatchObject({ status: 'sidecar_unreachable' })
  })

  it('parses status output tolerating missing Relay and Peers fields', () => {
    const runtime = parseNetbirdStatusOutput(
      JSON.stringify({ ManagementState: { Connected: false }, SignalState: { Connected: true } })
    )
    expect(runtime).toEqual({
      signalConnected: true,
      relayConnected: false,
      managementConnected: false,
      peerCount: 0
    })
    expect(parseNetbirdStatusOutput('garbage')).toBeNull()
  })
})
