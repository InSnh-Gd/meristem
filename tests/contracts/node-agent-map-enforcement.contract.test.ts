import { describe, expect, it } from 'bun:test'
import type {
  AclRuleFromSchema as AclRule,
  NetworkMapFromSchema as NetworkMap
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import { DEFAULT_CLOCK_SKEW_MS } from '../../services/m-net/src/key-lifecycle.ts'
import { DEFAULT_NETWORK_MAP_STALE_TTL_MS } from '../../services/m-net/src/network-map-renderer.ts'
import {
  buildNetworkMapSignatureMetadata,
  resolveNetworkMapSigningKeyMaterial
} from '../../services/m-net/src/network-map-signing.ts'
import {
  type AgentEnforcementState,
  applyEnforcementDecision,
  buildKeyMetadataReport,
  evaluateAclForPeer,
  evaluateNetworkMap
} from '../../services/node-agent/src/node-agent-map-enforcement.ts'

const signingKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
const signingPublicKey =
  signingKey.publicKey ??
  (() => {
    throw new Error('expected test signing public key')
  })()

function createAclRule(input: {
  action: 'allow' | 'deny'
  sourceNodeId: string
  targetNodeId: string
  protocol?: 'any' | 'tcp' | 'udp' | 'icmp'
}): AclRule {
  return {
    ruleId: `acl-${input.action}-${input.sourceNodeId}-${input.targetNodeId}`,
    action: input.action,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    protocol: input.protocol ?? 'any'
  }
}

function createNetworkMap(overrides?: {
  aclRules?: readonly AclRule[]
  expiresAt?: number
  mapVersion?: number
  signatureKeyId?: string
  signatureValue?: string
  members?: NetworkMap['members']
  relayAssignment?: NetworkMap['relayAssignment']
}): NetworkMap {
  const networkId = 'network-1'
  const mapVersion = overrides?.mapVersion ?? 3
  const signatureKeyId = overrides?.signatureKeyId ?? 'signing-key-1'

  const unsignedMap = {
    profileVersion: 'm-net-cn@0.2.0' as const,
    networkId,
    members: overrides?.members ?? [
      {
        nodeId: 'node-1',
        tunnelIp: '100.96.0.1',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      },
      {
        nodeId: 'node-2',
        tunnelIp: '100.96.0.2',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
      },
      {
        nodeId: 'node-3',
        tunnelIp: '100.96.0.3',
        publicKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC='
      }
    ],
    aclRules: overrides?.aclRules ?? [
      createAclRule({ action: 'allow', sourceNodeId: 'node-1', targetNodeId: 'node-2' }),
      createAclRule({ action: 'allow', sourceNodeId: 'node-2', targetNodeId: 'node-1' })
    ],
    relayAssignment: overrides?.relayAssignment ?? {
      relayType: 'wstunnel' as const,
      relayEndpoint: 'wss://relay.example',
      nodeIds: ['node-1', 'node-2']
    },
    expiresAt:
      overrides?.expiresAt ??
      Date.parse('2026-06-18T12:15:00.000Z') + DEFAULT_NETWORK_MAP_STALE_TTL_MS,
    mapVersion
  }

  const signatureMetadata = overrides?.signatureValue
    ? {
        algorithm: 'ed25519' as const,
        keyId: signatureKeyId,
        publicKey: signingPublicKey,
        value: overrides.signatureValue
      }
    : buildNetworkMapSignatureMetadata(unsignedMap, {
        keyId: signatureKeyId,
        privateKeyPem: signingKey.privateKeyPem,
        publicKey: signingPublicKey
      })

  return {
    ...unsignedMap,
    signatureMetadata
  }
}

function createConnectedEnforcementState(): AgentEnforcementState {
  return {
    status: 'applied',
    currentMapVersion: 2,
    knownPeers: [],
    allowedPeers: [],
    lastDecision: { decision: 'apply' },
    partition: {
      networkId: 'network-1',
      state: 'connected',
      reason: { code: 'initial.connect', detail: 'initial map applied' },
      transitionedAt: '2026-06-18T12:00:00.000Z',
      previousState: null
    }
  }
}

describe('node-agent map enforcement contract', () => {
  it('applies a valid signed network map and records the peer set, tunnel IPs, and relay metadata', () => {
    const evaluated = evaluateNetworkMap({
      map: createNetworkMap(),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })

    expect(evaluated.decision).toBe('apply')
    if (evaluated.decision !== 'apply') {
      throw new Error('expected apply decision')
    }
    expect(evaluated.peerSet.map(peer => peer.nodeId)).toEqual(['node-2', 'node-3'])
    expect(evaluated.peerSet.map(peer => peer.tunnelIp)).toEqual(['100.96.0.2', '100.96.0.3'])
    expect(evaluated.allowedPeers.map(peer => peer.nodeId)).toEqual(['node-2'])
    expect(evaluated.relayAssignment).toEqual({
      relayType: 'wstunnel',
      relayEndpoint: 'wss://relay.example',
      nodeIds: ['node-1', 'node-2']
    })

    const nextState = applyEnforcementDecision(evaluated, createConnectedEnforcementState())
    expect(nextState.status).toBe('applied')
    expect(nextState.currentMapVersion).toBe(3)
    expect(nextState.knownPeers.map(peer => peer.nodeId)).toEqual(['node-2', 'node-3'])
    expect(nextState.allowedPeers.map(peer => peer.nodeId)).toEqual(['node-2'])
    expect(nextState.partition.state).toBe('connected')
    expect(nextState.currentSigningKeyId).toBe('signing-key-1')
  })

  it('fails closed when the network map is stale past the default TTL boundary', () => {
    const expiresAt = Date.parse('2026-06-18T12:00:00.000Z')
    const evaluated = evaluateNetworkMap({
      map: createNetworkMap({ expiresAt }),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: expiresAt + DEFAULT_NETWORK_MAP_STALE_TTL_MS + 1,
      serverTime: '2026-06-18T12:15:00.001Z',
      staleTtlMs: DEFAULT_NETWORK_MAP_STALE_TTL_MS
    })

    expect(evaluated).toMatchObject({
      decision: 'fail_closed',
      reason: 'network_map.stale'
    })
  })

  it('rejects a network map whose signature metadata does not match the trusted signing key', () => {
    const evaluated = evaluateNetworkMap({
      map: createNetworkMap({
        signatureValue: Buffer.from('not-a-valid-signature', 'utf8').toString('base64')
      }),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })

    expect(evaluated).toMatchObject({
      decision: 'fail_closed',
      reason: 'network_map.invalid_signature'
    })
  })

  it('rejects map version regression before replacing the current local map', () => {
    const evaluated = evaluateNetworkMap({
      map: createNetworkMap({ mapVersion: 2 }),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      previousMapVersion: 3,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })

    expect(evaluated).toMatchObject({
      decision: 'fail_closed',
      reason: 'network_map.version_regression'
    })
  })

  it('rejects map application when control-plane clock skew exceeds five minutes', () => {
    const evaluated = evaluateNetworkMap({
      map: createNetworkMap(),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:26:00.001Z',
      maxClockSkewMs: DEFAULT_CLOCK_SKEW_MS
    })

    expect(evaluated).toMatchObject({
      decision: 'fail_closed',
      reason: 'clock.skew_exceeded'
    })
  })

  it('integrates the partition state machine from connected to stale to fail_closed and back to recovered', () => {
    const staleDecision = evaluateNetworkMap({
      map: createNetworkMap({ expiresAt: Date.parse('2026-06-18T12:00:00.000Z') }),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:15:00.001Z'),
      serverTime: '2026-06-18T12:15:00.001Z'
    })
    const connectedState = createConnectedEnforcementState()
    const staleState = applyEnforcementDecision(staleDecision, connectedState)
    const failClosedState = applyEnforcementDecision(staleDecision, staleState)

    expect(staleState.status).toBe('stale')
    expect(staleState.partition.state).toBe('stale')
    expect(failClosedState.status).toBe('fail_closed')
    expect(failClosedState.partition.state).toBe('fail_closed')

    const recoveredDecision = evaluateNetworkMap({
      map: createNetworkMap(),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })
    const recoveredState = applyEnforcementDecision(recoveredDecision, failClosedState)

    expect(recoveredState.status).toBe('applied')
    expect(recoveredState.partition.state).toBe('recovered')
  })

  it('builds the key metadata report sent back to M-Net without exposing private key material', () => {
    expect(
      buildKeyMetadataReport({
        keyId: 'key-1',
        fingerprint: 'wg:deadbeef',
        createdAt: '2026-06-18T12:00:00.000Z',
        rotationDueAt: '2026-07-18T12:00:00.000Z'
      })
    ).toEqual({
      keyId: 'key-1',
      fingerprint: 'wg:deadbeef',
      createdAt: '2026-06-18T12:00:00.000Z',
      rotationDueAt: '2026-07-18T12:00:00.000Z'
    })
  })

  it('evaluates rendered ACL rules with default deny and allow-specific peer access', () => {
    const denyAllMap = createNetworkMap({ aclRules: [] })
    const denyAll = evaluateNetworkMap({
      map: denyAllMap,
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })

    expect(denyAll.decision).toBe('apply')
    if (denyAll.decision !== 'apply') {
      throw new Error('expected apply decision for deny-all map')
    }
    expect(denyAll.allowedPeers).toHaveLength(0)
    expect(evaluateAclForPeer([], 'node-1', 'node-2')).toEqual({
      kind: 'deny',
      reason: 'acl.default_deny'
    })

    const allowSpecificRules = [
      createAclRule({ action: 'allow', sourceNodeId: 'node-1', targetNodeId: 'node-3' }),
      createAclRule({ action: 'allow', sourceNodeId: 'node-3', targetNodeId: 'node-1' }),
      createAclRule({ action: 'deny', sourceNodeId: 'node-1', targetNodeId: 'node-2' })
    ]
    const allowSpecific = evaluateNetworkMap({
      map: createNetworkMap({ aclRules: allowSpecificRules }),
      agentNodeId: 'node-1',
      expectedSigningKeyId: 'signing-key-1',
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T12:20:00.000Z'),
      serverTime: '2026-06-18T12:20:00.000Z'
    })

    expect(allowSpecific.decision).toBe('apply')
    if (allowSpecific.decision !== 'apply') {
      throw new Error('expected apply decision for allow-specific map')
    }
    expect(allowSpecific.allowedPeers.map(peer => peer.nodeId)).toEqual(['node-3'])
    expect(evaluateAclForPeer(allowSpecificRules, 'node-1', 'node-2')).toEqual({
      kind: 'deny',
      reason: 'acl.explicit_deny'
    })
    expect(evaluateAclForPeer(allowSpecificRules, 'node-1', 'node-3')).toEqual({
      kind: 'allow'
    })
  })
})
