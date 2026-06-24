import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createInitialEnforcementState,
  reconcileLocalOverlay,
  type LocalOverlayEnv
} from '../../services/node-agent/src/node-agent-local-apply.ts'
import { generateWireGuardKeyMaterial } from '../../services/node-agent/src/node-agent-wireguard-keys.ts'
import {
  buildNetworkMapSignatureMetadata,
  resolveNetworkMapSigningKeyMaterial
} from '../../services/m-net/src/network-map-signing.ts'
import type { NetworkMapFromSchema as NetworkMap } from '../../packages/contracts/src/schemas/mnet-profile.ts'

const signingKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
const FORBIDDEN_HOST_REDIRECT_TOKENS = ['iptables', 'nft', 'OUTPUT', 'SNAT', 'MASQUERADE']

function createSignedMap(overrides?: {
  relayType?: 'wstunnel' | 'direct'
  expiresAt?: number
  relayEndpoint?: string
}): NetworkMap {
  const unsignedMap = {
    profileVersion: 'm-net-cn@0.2.0' as const,
    networkId: 'network-prod-a',
    members: [
      {
        nodeId: 'leaf-cn-1',
        tunnelIp: '100.96.0.2',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      },
      {
        nodeId: 'leaf-cn-2',
        tunnelIp: '100.96.0.3',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
      }
    ],
    aclRules: [
      {
        ruleId: 'allow-1',
        action: 'allow' as const,
        sourceNodeId: 'leaf-cn-1',
        targetNodeId: 'leaf-cn-2',
        protocol: 'any' as const
      }
    ],
    relayAssignment: {
      relayType: overrides?.relayType ?? 'wstunnel',
      relayEndpoint: overrides?.relayEndpoint ?? 'wss://relay.example',
      nodeIds: ['leaf-cn-1', 'leaf-cn-2']
    },
    expiresAt: overrides?.expiresAt ?? Date.now() + 60_000,
    mapVersion: 7
  }

  return {
    ...unsignedMap,
    signatureMetadata: buildNetworkMapSignatureMetadata(unsignedMap, signingKey)
  }
}

async function createEnv(commandLog: string[][]): Promise<LocalOverlayEnv> {
  const root = await mkdtemp('/tmp/meristem-node-overlay-')
  let interfaceExists = false
  return {
    interfaceName: 'meristem-wg0',
    listenPort: 51820,
    localRelayEndpoint: '127.0.0.1:51821',
    forceRelayEndpoint: false,
    expectedSigningKeyId: signingKey.keyId,
    ...(signingKey.publicKey ? { expectedSigningPublicKey: signingKey.publicKey } : {}),
    ipBinaryPath: 'ip',
    wgBinaryPath: 'wg',
    paths: {
      privateKeyPath: join(root, 'wg', 'private.key'),
      configPath: join(root, 'wg', 'meristem-wg0.conf'),
      statePath: join(root, 'wg', 'state.json')
    },
    commandRunner: async command => {
      commandLog.push([...command])
      if (command.join(' ') === 'ip link show dev meristem-wg0') {
        if (!interfaceExists) throw new Error('missing interface')
      }
      if (command.join(' ') === 'ip link add dev meristem-wg0 type wireguard') {
        interfaceExists = true
      }
    }
  }
}

describe('node-agent local overlay apply', () => {
  it('writes config and applies WireGuard using local loopback relay for wstunnel maps', async () => {
    const commandLog: string[][] = []
    const env = await createEnv(commandLog)
    const result = await reconcileLocalOverlay({
      env,
      map: createSignedMap(),
      agentNodeId: 'leaf-cn-1',
      keyMaterial: generateWireGuardKeyMaterial(new Date('2026-06-18T00:00:00.000Z')),
      currentState: createInitialEnforcementState('network-prod-a'),
      nowMs: Date.now(),
      serverTime: new Date().toISOString()
    })

    expect(result.kind).toBe('applied')
    expect(commandLog).toEqual([
      ['ip', 'link', 'show', 'dev', 'meristem-wg0'],
      ['ip', 'link', 'add', 'dev', 'meristem-wg0', 'type', 'wireguard'],
      ['wg', 'setconf', 'meristem-wg0', env.paths.configPath],
      ['ip', 'address', 'replace', '100.96.0.2/32', 'dev', 'meristem-wg0'],
      ['ip', 'link', 'set', 'up', 'dev', 'meristem-wg0'],
      ['ip', 'route', 'replace', '100.96.0.3/32', 'dev', 'meristem-wg0']
    ])
    expect(await stat(env.paths.configPath)).toBeDefined()
    const renderedConfig = await readFile(env.paths.configPath, 'utf8')
    expect(renderedConfig.includes('Endpoint = 127.0.0.1:51821')).toBe(true)

    const flattenedCommandLog = commandLog.map(command => command.join(' ')).join('\n')
    for (const forbiddenToken of FORBIDDEN_HOST_REDIRECT_TOKENS) {
      expect(flattenedCommandLog).not.toContain(forbiddenToken)
    }
  })

  it('tears down local state when the signed map is stale', async () => {
    const commandLog: string[][] = []
    const env = await createEnv(commandLog)
    const result = await reconcileLocalOverlay({
      env,
      map: createSignedMap({ expiresAt: Date.now() - 2_000_000 }),
      agentNodeId: 'leaf-cn-1',
      keyMaterial: generateWireGuardKeyMaterial(new Date('2026-06-18T00:00:00.000Z')),
      currentState: createInitialEnforcementState('network-prod-a'),
      nowMs: Date.now(),
      serverTime: new Date().toISOString()
    })

    expect(result).toMatchObject({ kind: 'torn_down', reason: 'network_map.stale' })
    expect(commandLog).toEqual([['ip', 'link', 'delete', 'dev', 'meristem-wg0']])
  })

  it('does not reset WireGuard when the rendered config hash is unchanged', async () => {
    const commandLog: string[][] = []
    const env = await createEnv(commandLog)
    const keyMaterial = generateWireGuardKeyMaterial(new Date('2026-06-18T00:00:00.000Z'))
    const first = await reconcileLocalOverlay({
      env,
      map: createSignedMap(),
      agentNodeId: 'leaf-cn-1',
      keyMaterial,
      currentState: createInitialEnforcementState('network-prod-a'),
      nowMs: Date.now(),
      serverTime: new Date().toISOString()
    })
    expect(first.kind).toBe('applied')
    commandLog.length = 0

    const second = await reconcileLocalOverlay({
      env,
      map: createSignedMap(),
      agentNodeId: 'leaf-cn-1',
      keyMaterial,
      currentState: first.state,
      nowMs: Date.now(),
      serverTime: new Date().toISOString()
    })

    expect(second.kind).toBe('applied')
    expect(commandLog).toEqual([
      ['ip', 'link', 'show', 'dev', 'meristem-wg0'],
      ['ip', 'address', 'replace', '100.96.0.2/32', 'dev', 'meristem-wg0'],
      ['ip', 'link', 'set', 'up', 'dev', 'meristem-wg0'],
      ['ip', 'route', 'replace', '100.96.0.3/32', 'dev', 'meristem-wg0']
    ])
  })

  it('retries WireGuard setconf after a partial apply failure', async () => {
    const commandLog: string[][] = []
    const env = await createEnv(commandLog)
    const originalRunner = env.commandRunner
    let setconfCalls = 0
    env.commandRunner = async command => {
      await originalRunner(command)
      if (command.join(' ') === `wg setconf meristem-wg0 ${env.paths.configPath}`) {
        setconfCalls += 1
        if (setconfCalls === 1) throw new Error('simulated setconf failure')
      }
    }
    const keyMaterial = generateWireGuardKeyMaterial(new Date('2026-06-18T00:00:00.000Z'))
    const map = createSignedMap()

    await expect(
      reconcileLocalOverlay({
        env,
        map,
        agentNodeId: 'leaf-cn-1',
        keyMaterial,
        currentState: createInitialEnforcementState('network-prod-a'),
        nowMs: Date.now(),
        serverTime: new Date().toISOString()
      })
    ).rejects.toThrow('simulated setconf failure')
    commandLog.length = 0

    const recovered = await reconcileLocalOverlay({
      env,
      map,
      agentNodeId: 'leaf-cn-1',
      keyMaterial,
      currentState: createInitialEnforcementState('network-prod-a'),
      nowMs: Date.now(),
      serverTime: new Date().toISOString()
    })

    expect(recovered.kind).toBe('applied')
    expect(setconfCalls).toBe(2)
    expect(commandLog).toContainEqual(['wg', 'setconf', 'meristem-wg0', env.paths.configPath])
  })
})
