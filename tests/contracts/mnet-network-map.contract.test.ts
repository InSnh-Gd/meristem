import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  type NetworkMapFromSchema as NetworkMap,
  NetworkMapEnforcementDecisionSchema,
  NetworkMapSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  DEFAULT_NETWORK_MAP_STALE_TTL_MS,
  decideNetworkMapEnforcement,
  renderNetworkMap,
  renderNetworkMapForNode,
  renderNetworkMaps,
  resolveNetworkMapStaleTtlMs
} from '../../services/m-net/src/network-map-renderer.ts'
import type {
  NetworkMapMemberInput,
  NetworkMapRenderInput,
  RequestedAclRule
} from '../../services/m-net/src/network-map-types.ts'
import { resolveNetworkMapSigningKeyMaterial } from '../../services/m-net/src/network-map-signing.ts'

const issuedAt = 1_800_000
const signingKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
const signingPublicKey =
  signingKey.publicKey ??
  (() => {
    throw new Error('expected test signing public key')
  })()

const stem: NetworkMapMemberInput = {
  nodeId: 'stem-a',
  nodeKind: 'stem',
  tunnelIp: '100.96.0.1',
  publicKey: 'pub-stem-a'
}

const leafA: NetworkMapMemberInput = {
  nodeId: 'leaf-a',
  nodeKind: 'leaf',
  tunnelIp: '100.96.0.11',
  publicKey: 'pub-leaf-a'
}

const leafB: NetworkMapMemberInput = {
  nodeId: 'leaf-b',
  nodeKind: 'leaf',
  tunnelIp: '100.96.0.12',
  publicKey: 'pub-leaf-b'
}

const removedLeaf: NetworkMapMemberInput = {
  nodeId: 'leaf-removed',
  nodeKind: 'leaf',
  tunnelIp: '100.96.0.13',
  publicKey: 'pub-leaf-removed'
}

function allow(sourceNodeId: string, targetNodeId: string): RequestedAclRule {
  return { action: 'allow', sourceNodeId, targetNodeId, protocol: 'any' }
}

function bidirectional(left: string, right: string): RequestedAclRule[] {
  return [allow(left, right), allow(right, left)]
}

function baseInput(
  members: NetworkMapMemberInput[],
  requestedAclRules: RequestedAclRule[]
): NetworkMapRenderInput {
  return {
    profileVersion: 'm-net-cn@0.2.0',
    networkId: 'network-prod-a',
    members,
    requestedAclRules,
    relayAssignment: {
      relayType: 'wstunnel',
      relayEndpoint: 'wss://relay.cn.example/mnet',
      nodeIds: members.map(member => member.nodeId)
    },
    issuedAt,
    previousMapVersion: 0,
    signingKeyId: signingKey.keyId,
    signingPrivateKeyPem: signingKey.privateKeyPem
  }
}

function sortedMemberIds(map: NetworkMap): string[] {
  return map.members.map(member => member.nodeId).sort((left, right) => left.localeCompare(right))
}

function sortedPublicKeys(map: NetworkMap): string[] {
  return map.members
    .map(member => member.publicKey)
    .sort((left, right) => left.localeCompare(right))
}

function decodeMap(map: NetworkMap): NetworkMap {
  return Schema.decodeUnknownSync(NetworkMapSchema)(map)
}

describe('M-Net signed network map contract', () => {
  it('renders an empty network as a valid signed map with empty members and ACL rules', () => {
    const map = renderNetworkMap(baseInput([], []))

    expect(decodeMap(map)).toEqual(map)
    expect(map.profileVersion).toBe('m-net-cn@0.2.0')
    expect(map.networkId).toBe('network-prod-a')
    expect(map.members).toEqual([])
    expect(map.aclRules).toEqual([])
    expect(map.expiresAt).toBe(issuedAt + DEFAULT_NETWORK_MAP_STALE_TTL_MS)
    expect(map.mapVersion).toBe(1)
    expect(map.signatureMetadata.algorithm).toBe('ed25519')
    expect(map.signatureMetadata.keyId).toBe(signingKey.keyId)
    expect(map.signatureMetadata.publicKey).toBe(signingPublicKey)
    expect(map.signatureMetadata.value.length).toBeGreaterThan(20)
  })

  it('renders a single leaf map with both peers, tunnel IPs, public keys, and ACL rules', () => {
    const map = renderNetworkMapForNode(
      baseInput([stem, leafA], bidirectional(stem.nodeId, leafA.nodeId)),
      leafA.nodeId
    )

    expect(decodeMap(map)).toEqual(map)
    expect(sortedMemberIds(map)).toEqual(['leaf-a', 'stem-a'])
    expect(sortedPublicKeys(map)).toEqual(['pub-leaf-a', 'pub-stem-a'])
    expect(map.members.map(member => member.tunnelIp).sort()).toEqual(['100.96.0.1', '100.96.0.11'])
    expect(map.aclRules).toHaveLength(2)
    expect(map.aclRules.map(rule => `${rule.sourceNodeId}->${rule.targetNodeId}`).sort()).toEqual([
      'leaf-a->stem-a',
      'stem-a->leaf-a'
    ])
  })

  it('renders per-node maps with stem-to-leaf peer sets and no leaf-to-leaf leakage', () => {
    const maps = renderNetworkMaps(
      baseInput(
        [stem, leafA, leafB],
        [...bidirectional(stem.nodeId, leafA.nodeId), ...bidirectional(stem.nodeId, leafB.nodeId)]
      )
    )

    const stemMap = maps.find(entry => entry.nodeId === stem.nodeId)?.map
    const leafAMap = maps.find(entry => entry.nodeId === leafA.nodeId)?.map
    const leafBMap = maps.find(entry => entry.nodeId === leafB.nodeId)?.map

    expect(stemMap).toBeDefined()
    expect(leafAMap).toBeDefined()
    expect(leafBMap).toBeDefined()
    expect(stemMap ? sortedMemberIds(stemMap) : []).toEqual(['leaf-a', 'leaf-b', 'stem-a'])
    expect(leafAMap ? sortedMemberIds(leafAMap) : []).toEqual(['leaf-a', 'stem-a'])
    expect(leafBMap ? sortedMemberIds(leafBMap) : []).toEqual(['leaf-b', 'stem-a'])
  })

  it('removes departed members from peer sets and ACL rules', () => {
    const map = renderNetworkMapForNode(
      baseInput(
        [stem, leafA],
        [
          ...bidirectional(stem.nodeId, leafA.nodeId),
          ...bidirectional(stem.nodeId, removedLeaf.nodeId),
          ...bidirectional(leafA.nodeId, removedLeaf.nodeId)
        ]
      ),
      stem.nodeId
    )

    expect(sortedPublicKeys(map)).not.toContain(removedLeaf.publicKey)
    expect(map.aclRules.some(rule => rule.sourceNodeId === removedLeaf.nodeId)).toBe(false)
    expect(map.aclRules.some(rule => rule.targetNodeId === removedLeaf.nodeId)).toBe(false)
  })

  it('defaults to deny-all when no rendered ACL rules are present', () => {
    const map = renderNetworkMapForNode(baseInput([stem, leafA], []), leafA.nodeId)

    expect(sortedMemberIds(map)).toEqual(['leaf-a'])
    expect(map.aclRules).toEqual([])
  })

  it('fails closed when the signed map is older than the default stale TTL', () => {
    const ttlMs = resolveNetworkMapStaleTtlMs({ MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS: undefined })
    const map = renderNetworkMap(baseInput([stem], []))
    const decision = decideNetworkMapEnforcement({
      map,
      nowMs: issuedAt + ttlMs + 1,
      previousMapVersion: 0
    })

    expect(ttlMs).toBe(900_000)
    expect(Schema.decodeUnknownSync(NetworkMapEnforcementDecisionSchema)(decision)).toEqual(
      decision
    )
    expect(decision).toEqual({ decision: 'fail_closed', reason: 'network_map.stale' })
  })

  it('renders monotonically increasing map versions across successive renders', () => {
    const firstMap = renderNetworkMap(baseInput([stem], []))
    const secondMap = renderNetworkMap({
      ...baseInput([stem], []),
      previousMapVersion: firstMap.mapVersion
    })

    expect(firstMap.mapVersion).toBe(1)
    expect(secondMap.mapVersion).toBeGreaterThan(firstMap.mapVersion)
    expect(secondMap.mapVersion).toBe(2)
  })

  it('includes signing metadata, profile version, network id, expiry, and numeric map version', () => {
    const map = renderNetworkMap(baseInput([stem, leafA], bidirectional(stem.nodeId, leafA.nodeId)))

    expect(map.profileVersion).toBe('m-net-cn@0.2.0')
    expect(map.networkId).toBe('network-prod-a')
    expect(map.expiresAt).toBe(issuedAt + DEFAULT_NETWORK_MAP_STALE_TTL_MS)
    expect(map.mapVersion).toBe(1)
    expect(map.signatureMetadata.algorithm).toBe('ed25519')
    expect(map.signatureMetadata.keyId).toBe(signingKey.keyId)
    expect(map.signatureMetadata.publicKey).toBe(signingPublicKey)
    expect(map.signatureMetadata.value).not.toContain('placeholder-signature')
  })

  it('lets node-agent enforcement consume rendered maps without dynamic M-Policy calls', () => {
    const policyCallCount = 0
    const map = renderNetworkMapForNode(
      baseInput([stem, leafA], bidirectional(stem.nodeId, leafA.nodeId)),
      leafA.nodeId
    )

    const canConnect = (sourceNodeId: string, targetNodeId: string) => {
      const rule = map.aclRules.find(
        candidate =>
          candidate.action === 'allow' &&
          candidate.sourceNodeId === sourceNodeId &&
          candidate.targetNodeId === targetNodeId
      )
      return rule !== undefined
    }

    expect(canConnect(leafA.nodeId, stem.nodeId)).toBe(true)
    expect(canConnect(leafA.nodeId, leafB.nodeId)).toBe(false)
    expect(policyCallCount).toBe(0)
  })
})
