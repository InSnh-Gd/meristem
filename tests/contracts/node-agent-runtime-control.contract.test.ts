import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  loadRuntimeCredentials,
  saveRuntimeCredentials
} from '../../services/node-agent/src/node-agent-runtime-state.ts'
import {
  fetchLatestNodeRuntimeNetworkMap,
  registerNodeRuntimeKey
} from '../../services/node-agent/src/node-agent-session.ts'
import {
  generateWireGuardKeyMaterial,
  loadOrCreateWireGuardKeyMaterial
} from '../../services/node-agent/src/node-agent-wireguard-keys.ts'

describe('node-agent runtime control helpers', () => {
  it('generates X25519 key material that matches WireGuard raw key lengths', () => {
    const key = generateWireGuardKeyMaterial(new Date('2026-06-18T00:00:00.000Z'))

    expect(key.keyId.startsWith('wg-')).toBe(true)
    expect(Buffer.from(key.publicKey, 'base64')).toHaveLength(32)
    expect(Buffer.from(key.privateKey, 'base64')).toHaveLength(32)
    expect(key.createdAt).toBe('2026-06-18T00:00:00.000Z')
  })

  it('persists WireGuard key material to host-local files and reuses it across restarts', async () => {
    const tempDir = await mkdtemp('/tmp/meristem-node-agent-')
    const privateKeyPath = join(tempDir, 'wg', 'private.key')

    const first = await loadOrCreateWireGuardKeyMaterial(
      privateKeyPath,
      new Date('2026-06-18T00:10:00.000Z')
    )
    const second = await loadOrCreateWireGuardKeyMaterial(
      privateKeyPath,
      new Date('2026-06-18T00:20:00.000Z')
    )

    expect(second).toEqual(first)
    expect((await readFile(privateKeyPath, 'utf8')).trim()).toBe(first.privateKey)
    expect((await readFile(`${privateKeyPath}.pub`, 'utf8')).trim()).toBe(first.publicKey)
  })

  it('persists runtime credentials so systemd restarts resume without join tickets', async () => {
    const tempDir = await mkdtemp('/tmp/meristem-node-runtime-')
    const runtimeStatePath = join(tempDir, 'runtime.json')

    const saved = saveRuntimeCredentials(
      { nodeId: 'node-systemd-1', runtimeToken: 'runtime-token-1' },
      runtimeStatePath,
      new Date('2026-06-18T00:30:00.000Z')
    )

    expect(saved).toEqual({
      nodeId: 'node-systemd-1',
      runtimeToken: 'runtime-token-1',
      savedAt: '2026-06-18T00:30:00.000Z'
    })
    expect(loadRuntimeCredentials(runtimeStatePath)).toEqual(saved)
    expect((await readFile(runtimeStatePath, 'utf8')).includes('runtime-token-1')).toBe(true)
  })

  it('registers node runtime keys and fetches signed maps through validated HTTP helpers', async () => {
    const registration = await registerNodeRuntimeKey(
      'http://127.0.0.1:3104',
      'leaf-cn-1',
      'runtime-token',
      {
        keyId: 'wg-runtime-key-1',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        createdAt: '2026-06-18T00:05:00.000Z'
      },
      async (_input, init) => {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({ authorization: 'Bearer runtime-token' })
        return new Response(
          JSON.stringify({
            nodeId: 'leaf-cn-1',
            keyId: 'wg-runtime-key-1',
            fingerprint: 'wg:AAAAAAAA',
            mapVersion: 7,
            correlationId: 'corr-1'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    )

    expect(registration).toEqual({
      kind: 'runtime.key.registered',
      nodeId: 'leaf-cn-1',
      keyId: 'wg-runtime-key-1',
      fingerprint: 'wg:AAAAAAAA',
      mapVersion: 7,
      correlationId: 'corr-1'
    })

    const latestMap = await fetchLatestNodeRuntimeNetworkMap(
      'http://127.0.0.1:3104',
      'leaf-cn-1',
      'runtime-token',
      async () =>
        new Response(
          JSON.stringify({
            map: {
              profileVersion: 'm-net-cn@0.3.0',
              networkId: 'network-prod-a',
              members: [
                {
                  nodeId: 'leaf-cn-1',
                  tunnelIp: '100.96.0.2',
                  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
                }
              ],
              aclRules: [],
              relayAssignment: {
                relayType: 'wstunnel',
                relayEndpoint: 'wss://relay.example',
                nodeIds: ['leaf-cn-1']
              },
              expiresAt: Date.parse('2026-06-18T01:00:00.000Z'),
              mapVersion: 7,
              signatureMetadata: {
                algorithm: 'ed25519',
                keyId: 'mnet-map-key-a',
                publicKey: 'PUBLICKEY==',
                value: 'SIGNATURE=='
              }
            },
            sidecar: {
              signalConfigRef: { configRef: 'netbird/signal/prod-a' },
              relayConfigRef: { configRef: 'netbird/relay/prod-a' },
              stunConfigRef: { configRef: 'netbird/stun/prod-a' },
              sidecarCredentialRef: {
                provider: 'vault-prod',
                keyPath: 'netbird/sidecar/prod-a'
              },
              desiredState: 'start',
              credentialStatus: 'ready',
              healthStatus: 'unknown',
              configHash: 'sidecar-config-hash'
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )

    expect(latestMap.kind).toBe('runtime.network_map.fetched')
    if (latestMap.kind === 'runtime.network_map.fetched') {
      expect(latestMap.map.networkId).toBe('network-prod-a')
      expect(latestMap.map.mapVersion).toBe(7)
      expect(latestMap.sidecar.desiredState).toBe('start')
      expect(latestMap.sidecar.sidecarCredentialRef).toEqual({
        provider: 'vault-prod',
        keyPath: 'netbird/sidecar/prod-a'
      })
    }
  })

  it('returns typed failures for invalid runtime responses', async () => {
    const registration = await registerNodeRuntimeKey(
      'http://127.0.0.1:3104',
      'leaf-cn-1',
      'runtime-token',
      {
        keyId: 'wg-runtime-key-1',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        createdAt: '2026-06-18T00:05:00.000Z'
      },
      async () =>
        new Response(JSON.stringify({ bad: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    expect(registration).toEqual({
      kind: 'runtime.request_failed',
      reason: 'runtime key registration response is invalid'
    })
  })
})
