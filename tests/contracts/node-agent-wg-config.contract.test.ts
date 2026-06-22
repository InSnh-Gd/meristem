import { describe, expect, it } from 'bun:test'
import type { NetworkMapFromSchema as NetworkMap } from '../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  checkWgTooling,
  computeConfigHash,
  DEFAULT_WG_LISTEN_PORT,
  DEFAULT_WSTUNNEL_UDP_BIND_HOST,
  DEFAULT_WSTUNNEL_UDP_BIND_PORT,
  renderWireGuardConfig
} from '../../services/node-agent/src/node-agent-wg-config.ts'
import {
  buildNetworkMapSignatureMetadata,
  resolveNetworkMapSigningKeyMaterial
} from '../../services/m-net/src/network-map-signing.ts'

const signingKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
const TEST_PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

function createNetworkMap(overrides?: {
  readonly members?: NetworkMap['members']
  readonly relayAssignment?: NetworkMap['relayAssignment']
  readonly mapVersion?: number
}): NetworkMap {
  const unsignedMap = {
    profileVersion: 'm-net-cn@0.2.0' as const,
    networkId: 'network-wg-1',
    members: overrides?.members ?? [
      {
        nodeId: 'node-agent-1',
        tunnelIp: '100.96.0.1',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      },
      {
        nodeId: 'node-peer-2',
        tunnelIp: '100.96.0.2',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
      },
      {
        nodeId: 'node-peer-3',
        tunnelIp: '100.96.0.3',
        publicKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC='
      }
    ],
    aclRules: [],
    relayAssignment: overrides?.relayAssignment ?? {
      relayType: 'wstunnel' as const,
      relayEndpoint: 'wss://relay.example',
      nodeIds: ['node-agent-1', 'node-peer-2', 'node-peer-3']
    },
    expiresAt: Date.parse('2026-06-18T12:15:00.000Z'),
    mapVersion: overrides?.mapVersion ?? 7
  }

  return {
    ...unsignedMap,
    signatureMetadata: buildNetworkMapSignatureMetadata(unsignedMap, signingKey)
  }
}

describe('node-agent WireGuard config contract', () => {
  it('renders deterministic INI config from a signed network map with two peers', () => {
    const rendered = renderWireGuardConfig({
      map: createNetworkMap(),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })

    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error(rendered.error.kind)

    expect(rendered.value.peerCount).toBe(2)
    expect(rendered.value.listenPort).toBe(DEFAULT_WG_LISTEN_PORT)
    expect(rendered.value.config).toBe(
      [
        '[Interface]',
        `PrivateKey = ${TEST_PRIVATE_KEY}`,
        `ListenPort = ${DEFAULT_WG_LISTEN_PORT}`,
        '',
        '[Peer]',
        'PublicKey = BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        'AllowedIPs = 100.96.0.2/32',
        `Endpoint = ${DEFAULT_WSTUNNEL_UDP_BIND_HOST}:${DEFAULT_WSTUNNEL_UDP_BIND_PORT}`,
        '',
        '[Peer]',
        'PublicKey = CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=',
        'AllowedIPs = 100.96.0.3/32',
        `Endpoint = ${DEFAULT_WSTUNNEL_UDP_BIND_HOST}:${DEFAULT_WSTUNNEL_UDP_BIND_PORT}`
      ].join('\n')
    )
  })

  it('uses the direct relay endpoint as the peer endpoint when the map declares direct transport', () => {
    const rendered = renderWireGuardConfig({
      map: createNetworkMap({
        relayAssignment: {
          relayType: 'direct',
          relayEndpoint: 'https://direct-peer.example:51820',
          nodeIds: ['node-agent-1', 'node-peer-2', 'node-peer-3']
        }
      }),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })

    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error(rendered.error.kind)
    expect(rendered.value.config).toContain('Endpoint = direct-peer.example:51820')
  })

  it('inlines the private key content into the config for wg setconf consumption', () => {
    const rendered = renderWireGuardConfig({
      map: createNetworkMap(),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })

    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error(rendered.error.kind)

    expect(rendered.value.config).toContain(`PrivateKey = ${TEST_PRIVATE_KEY}`)
  })

  it('accepts parseable wg version output and returns typed metadata', () => {
    const result = checkWgTooling({
      wgBinaryPath: '/usr/bin/wg',
      wgVersionOutput: 'wireguard-tools v1.0.20210914 - https://www.wireguard.com/',
      wireguardGoBinaryPath: '/usr/bin/wireguard-go',
      wireguardGoVersionOutput: 'wireguard-go version 0.0.20220316'
    })

    expect(result).toEqual({
      ok: true,
      value: {
        wg: {
          binary: 'wg',
          path: '/usr/bin/wg',
          version: '1.0.20210914'
        },
        wireguardGo: {
          binary: 'wireguard-go',
          path: '/usr/bin/wireguard-go',
          version: '0.0.20220316'
        }
      }
    })
  })

  it('returns a typed wg.binary_missing error when the wg binary path is absent', () => {
    const result = checkWgTooling({
      wgBinaryPath: '',
      wgVersionOutput: 'wireguard-tools v1.0.20210914'
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'wg.binary_missing',
        binary: 'wg'
      }
    })
  })

  it('produces the same SHA-256 hash for the same config and a different hash for a changed map', () => {
    const first = renderWireGuardConfig({
      map: createNetworkMap(),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })
    const second = renderWireGuardConfig({
      map: createNetworkMap(),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })
    const changed = renderWireGuardConfig({
      map: createNetworkMap({
        members: [
          {
            nodeId: 'node-agent-1',
            tunnelIp: '100.96.0.1',
            publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
          },
          {
            nodeId: 'node-peer-2',
            tunnelIp: '100.96.0.22',
            publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
          }
        ],
        relayAssignment: {
          relayType: 'wstunnel',
          relayEndpoint: 'wss://relay.example',
          nodeIds: ['node-agent-1', 'node-peer-2']
        }
      }),
      agentNodeId: 'node-agent-1',
      privateKey: TEST_PRIVATE_KEY
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(changed.ok).toBe(true)
    if (!first.ok || !second.ok || !changed.ok) throw new Error('expected rendered configs')

    const firstHash = computeConfigHash(first.value.config)
    const secondHash = computeConfigHash(second.value.config)
    const changedHash = computeConfigHash(changed.value.config)

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toHaveLength(64)
    expect(changedHash).toHaveLength(64)
    expect(firstHash).not.toBe(changedHash)
  })

  it('renders a valid interface-only config when the peer set is empty', () => {
    const rendered = renderWireGuardConfig({
      map: createNetworkMap({
        members: [
          {
            nodeId: 'node-agent-1',
            tunnelIp: '100.96.0.1',
            publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
          }
        ],
        relayAssignment: undefined
      }),
      agentNodeId: 'node-agent-1',
      listenPort: 51821,
      privateKey: TEST_PRIVATE_KEY
    })

    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error(rendered.error.kind)

    expect(rendered.value.peerCount).toBe(0)
    expect(rendered.value.config).toBe(
      [
        '[Interface]',
        `PrivateKey = ${TEST_PRIVATE_KEY}`,
        'ListenPort = 51821'
      ].join('\n')
    )
  })
})
