import { describe, expect, it } from 'bun:test'
import {
  assessOfflineLeafMigration,
  evaluateAcmeDirectoryHealth,
  eventBusUnavailable,
  planFailClosedTunnelTeardown,
  resolveRelayAvailability
} from '../../services/m-net/src/data-plane-security-support.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import { gateClockSkew, rejectDuplicatePublicKey } from '../../services/m-net/src/key-lifecycle.ts'
import { registerNodePublicKey } from '../../services/m-net/src/mnet-dataplane-workflows.ts'
import { assignNodeTunnelIp } from '../../services/m-net/src/overlay-cidr.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import {
  type AgentEnforcementState,
  applyEnforcementDecision,
  evaluateNetworkMap
} from '../../services/node-agent/src/node-agent-map-enforcement.ts'
import { redeemJoinTicket as parseJoinTicketRedeemResult } from '../../services/node-agent/src/node-agent-session.ts'
import {
  createLogBuffer,
  formatTaskResult
} from '../../services/node-agent/src/node-agent-task-log.ts'
import {
  buildNetworkMapSignatureMetadata,
  resolveNetworkMapSigningKeyMaterial
} from '../../services/m-net/src/network-map-signing.ts'

const signingKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })
const signingPublicKey =
  signingKey.publicKey ??
  (() => {
    throw new Error('expected test signing public key')
  })()

function createDeps() {
  const dataPlane = createInMemoryDataPlaneStores()
  const profileStore = createInMemoryProfileStore()

  return {
    profileStore,
    dataPlane,
    policyAuthorize: {
      async authorize() {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    },
    listMembers: async ({ networkId }: { networkId: string }) => ({
      ok: true as const,
      value: [
        {
          networkId,
          nodeId: 'stem-a',
          nodeKind: 'stem' as const,
          membershipMode: 'full' as const,
          status: 'joined' as const,
          joinedAt: '2026-06-18T00:00:00.000Z'
        },
        {
          networkId,
          nodeId: 'leaf-a',
          nodeKind: 'leaf' as const,
          membershipMode: 'restricted' as const,
          status: 'joined' as const,
          joinedAt: '2026-06-18T00:01:00.000Z'
        }
      ]
    }),
    events: {
      async publish() {
        /* noop */
      }
    },
    log: {
      async writeTimeline() {
        /* noop */
      },
      async writeFull() {
        /* noop */
      },
      async writeAudit() {
        /* noop */
      }
    },
    networkUpdater: {
      async setProfileVersion() {
        /* noop */
      }
    }
  }
}

function createSignedMap(expiresAt: number) {
  const unsignedMap = {
    profileVersion: 'm-net-cn@0.2.0' as const,
    networkId: 'network-hardening',
    members: [
      {
        nodeId: 'stem-a',
        tunnelIp: '100.96.0.1',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      },
      {
        nodeId: 'leaf-a',
        tunnelIp: '100.96.0.2',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
      }
    ],
    aclRules: [
      {
        ruleId: 'acl-1',
        action: 'allow' as const,
        sourceNodeId: 'stem-a',
        targetNodeId: 'leaf-a',
        protocol: 'any' as const
      }
    ],
    relayAssignment: {
      relayType: 'wstunnel' as const,
      relayEndpoint: 'wss://relay.example',
      nodeIds: ['stem-a', 'leaf-a']
    },
    expiresAt,
    mapVersion: 7
  }

  return {
    ...unsignedMap,
    signatureMetadata: buildNetworkMapSignatureMetadata(unsignedMap, signingKey)
  }
}

function createEnforcementState(): AgentEnforcementState {
  return {
    status: 'applied',
    currentMapVersion: 6,
    currentSigningKeyId: 'signing-key-1',
    localTunnelIp: '100.96.0.1',
    knownPeers: [],
    allowedPeers: [],
    partition: {
      networkId: 'network-hardening',
      state: 'connected',
      reason: { code: 'initial.connect', detail: 'bootstrap connected' },
      transitionedAt: '2026-06-18T00:00:00.000Z',
      previousState: null
    }
  }
}

describe('M-Net data-plane security hardening failure modes', () => {
  it('rejects duplicate public keys with typed key.duplicate metadata', () => {
    const result = rejectDuplicatePublicKey({
      nodeId: 'leaf-b',
      keyId: 'key-b',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      createdAt: '2026-06-18T00:00:00.000Z',
      existingKeys: [
        {
          nodeId: 'stem-a',
          keyId: 'key-a',
          publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          fingerprint: 'wg:dedupe',
          algorithm: 'wireguard-x25519',
          createdAt: '2026-06-17T00:00:00.000Z',
          rotationCounter: 0
        }
      ]
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('expected duplicate rejection')
    }
    expect(result.error.kind).toBe('key.duplicate')
    if (result.error.kind !== 'key.duplicate') {
      throw new Error('expected key.duplicate failure')
    }
    expect(result.error.auditMetadata.existingNodeId).toBe('stem-a')
  })

  it('surfaces workflow duplicate detection when one node retries the same key registration', async () => {
    const deps = createDeps()
    await deps.profileStore.setNetworkState('network-hardening', {
      profileVersion: 'm-net-cn@0.2.0',
      status: 'enabled'
    })
    await deps.dataPlane.nodePublicKeys.upsert({
      nodeId: 'leaf-a',
      keyId: 'key-a',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      fingerprint: 'wg:dupe-a',
      algorithm: 'wireguard-x25519',
      createdAt: '2026-06-18T00:00:00.000Z',
      rotationCounter: 0,
      status: 'active'
    })

    const result = await registerNodePublicKey(deps, {
      networkId: 'network-hardening',
      nodeId: 'leaf-a',
      keyId: 'key-b',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      createdAt: '2026-06-18T01:00:00.000Z'
    })

    expect(result).toEqual({
      kind: 'failure',
      status: 409,
      error: {
        code: 'key.duplicate',
        message: 'duplicate or invalid public key rejected'
      }
    })
  })

  it('fails closed for join and key registration when clock skew exceeds five minutes', () => {
    expect(
      gateClockSkew({
        operation: 'join',
        observedAt: '2026-06-18T00:00:00.000Z',
        reportedAt: '2026-06-18T00:05:00.001Z'
      })
    ).toEqual({
      ok: false,
      error: {
        kind: 'clock.skew_exceeded',
        skewMs: 300001,
        maxSkewMs: 300000,
        logEvidence: {
          event: 'mnet.clock_skew.rejected',
          operation: 'join'
        },
        auditEvidence: {
          action: 'mnet.clock_skew.rejected',
          result: 'rejected'
        }
      }
    })

    const keyRegistration = gateClockSkew({
      operation: 'key_registration',
      observedAt: '2026-06-18T00:00:00.000Z',
      reportedAt: '2026-06-18T00:06:00.000Z'
    })
    expect(keyRegistration.ok).toBe(false)
    if (keyRegistration.ok) {
      throw new Error('expected skew failure')
    }
    expect(keyRegistration.error.kind).toBe('clock.skew_exceeded')
  })

  it('rejects expired and revoked join tickets without issuing credentials', () => {
    const expired = parseJoinTicketRedeemResult(
      'https://join.example/join/v0/session',
      'ticket-1',
      {
        type: 'error',
        code: 'node.join_ticket_expired',
        message: 'join ticket is expired'
      }
    )
    expect(expired).toEqual({
      kind: 'join.rejected',
      reason: 'join ticket is expired'
    })

    const revoked = parseJoinTicketRedeemResult(
      'https://join.example/join/v0/session',
      'ticket-2',
      {
        type: 'error',
        code: 'node.join_ticket_revoked',
        message: 'join ticket has been revoked'
      }
    )
    expect(revoked).toEqual({
      kind: 'join.rejected',
      reason: 'join ticket has been revoked'
    })
  })

  it('returns a typed conflict when credential rotation requests race on the same node', async () => {
    const deps = createDeps()
    await deps.profileStore.setNetworkState('network-hardening', {
      profileVersion: 'm-net-cn@0.2.0',
      status: 'enabled'
    })

    const first = await registerNodePublicKey(deps, {
      networkId: 'network-hardening',
      nodeId: 'leaf-a',
      keyId: 'rotate-1',
      publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      createdAt: '2026-06-18T00:10:00.000Z'
    })
    expect('kind' in first).toBe(false)

    const second = await registerNodePublicKey(deps, {
      networkId: 'network-hardening',
      nodeId: 'leaf-a',
      keyId: 'rotate-2',
      publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      createdAt: '2026-06-18T00:10:01.000Z'
    })

    expect(second).toEqual({
      kind: 'failure',
      status: 409,
      error: {
        code: 'key.duplicate',
        message: 'duplicate or invalid public key rejected'
      }
    })
  })

  it('moves stale-map evaluation into stale then fail_closed partition states with tunnel teardown plan', () => {
    const expiresAt = Date.parse('2026-06-18T00:00:00.000Z')
    const decision = evaluateNetworkMap({
      map: createSignedMap(expiresAt),
      agentNodeId: 'stem-a',
      expectedSigningKeyId: signingKey.keyId,
      expectedSigningPublicKey: signingPublicKey,
      nowMs: expiresAt + 900001,
      serverTime: new Date(expiresAt + 900001).toISOString(),
      staleTtlMs: 900000
    })

    const staleState = applyEnforcementDecision(decision, createEnforcementState())
    const failClosedState = applyEnforcementDecision(decision, staleState)

    expect(staleState.status).toBe('stale')
    expect(staleState.partition.reason.code).toBe('network_map.stale')
    expect(failClosedState.status).toBe('fail_closed')
    expect(failClosedState.partition.reason.code).toBe('network_map.expired')
    expect(planFailClosedTunnelTeardown('network-hardening', ['leaf-a', 'stem-a'])).toEqual([
      { nodeId: 'leaf-a', configHash: 'fail-closed:network-hardening' },
      { nodeId: 'stem-a', configHash: 'fail-closed:network-hardening' }
    ])
  })

  it('reports control-channel partition by failing closed on invalid signatures and preserves prior peers', () => {
    const invalidSignature = evaluateNetworkMap({
      map: {
        ...createSignedMap(Date.parse('2026-06-18T00:30:00.000Z')),
        signatureMetadata: {
          ...createSignedMap(Date.parse('2026-06-18T00:30:00.000Z')).signatureMetadata,
          value: Buffer.from('tampered-signature', 'utf8').toString('base64')
        }
      },
      agentNodeId: 'stem-a',
      expectedSigningKeyId: signingKey.keyId,
      expectedSigningPublicKey: signingPublicKey,
      nowMs: Date.parse('2026-06-18T00:10:00.000Z'),
      serverTime: '2026-06-18T00:10:00.000Z'
    })

    const current = {
      ...createEnforcementState(),
      knownPeers: [{ nodeId: 'leaf-a', tunnelIp: '100.96.0.2', publicKey: 'BBBB' }],
      allowedPeers: [{ nodeId: 'leaf-a', tunnelIp: '100.96.0.2', publicKey: 'BBBB' }]
    }
    const next = applyEnforcementDecision(invalidSignature, current)

    expect(next.status).toBe('fail_closed')
    expect(next.failureReason).toBe('network_map.invalid_signature')
    expect(next.knownPeers).toEqual(current.knownPeers)
  })

  it('maps event bus outages to typed event_bus.unavailable failures', () => {
    expect(eventBusUnavailable(new Error('nats unavailable'))).toEqual({
      kind: 'failure',
      status: 503,
      error: {
        code: 'event_bus.unavailable',
        message: 'nats unavailable'
      }
    })
  })

  it('falls back from relay outage to direct path or fails closed when no direct path exists', () => {
    expect(resolveRelayAvailability({ relayReachable: false, directPathAvailable: true })).toEqual({
      kind: 'direct_fallback',
      relayType: 'direct',
      reason: {
        code: 'relay.unavailable',
        message: 'wstunnel relay is unavailable'
      }
    })

    expect(resolveRelayAvailability({ relayReachable: false, directPathAvailable: false })).toEqual(
      {
        kind: 'fail_closed',
        error: {
          code: 'relay.unavailable',
          message: 'wstunnel relay is unavailable'
        }
      }
    )
  })

  it('returns typed address exhaustion for a fully allocated /30 subnet', () => {
    const result = assignNodeTunnelIp({
      networkId: 'network-hardening',
      nodeId: 'leaf-c',
      subnetCidr: '100.96.0.0/30',
      existingAssignments: [
        {
          networkId: 'network-hardening',
          nodeId: 'leaf-a',
          tunnelIp: '100.96.0.1',
          cidr: '100.96.0.0/30'
        },
        {
          networkId: 'network-hardening',
          nodeId: 'leaf-b',
          tunnelIp: '100.96.0.2',
          cidr: '100.96.0.0/30'
        }
      ]
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'address.exhausted',
        networkId: 'network-hardening',
        cidr: '100.96.0.0/30'
      }
    })
  })

  it('keeps offline leaf migration pending instead of falsely reporting success', () => {
    expect(
      assessOfflineLeafMigration([
        { nodeId: 'stem-a', nodeKind: 'stem', status: 'joined' },
        { nodeId: 'leaf-a', nodeKind: 'leaf', status: 'offline' },
        { nodeId: 'leaf-b', nodeKind: 'leaf', status: 'pending' }
      ])
    ).toEqual({
      kind: 'pending',
      pendingNodeIds: ['leaf-a', 'leaf-b'],
      status: 'pending',
      message: 'offline leaf members require follow-up before migration can complete'
    })
  })

  it('returns typed ACME directory failures with explicit fallback behavior', () => {
    expect(
      evaluateAcmeDirectoryHealth({
        mode: 'acme',
        directoryUrl: 'https://acme.example/directory',
        directoryReachable: false,
        localDevFallbackAllowed: true
      })
    ).toEqual({
      kind: 'fallback',
      mode: 'local-dev',
      error: {
        code: 'acme.directory_unavailable',
        message: 'ACME directory is unreachable',
        directoryUrl: 'https://acme.example/directory'
      }
    })

    expect(
      evaluateAcmeDirectoryHealth({
        mode: 'acme',
        directoryUrl: 'https://acme.example/directory',
        directoryReachable: false,
        localDevFallbackAllowed: false
      })
    ).toEqual({
      kind: 'fail_closed',
      error: {
        code: 'acme.directory_unavailable',
        message: 'ACME directory is unreachable',
        directoryUrl: 'https://acme.example/directory'
      }
    })
  })

  it('keeps task/log metadata structured when sidecar crash and policy denial need degraded reporting', () => {
    const buffer = createLogBuffer(2, 1000, () => 0)
    buffer.add({
      timestamp: '2026-06-18T00:00:00.000Z',
      level: 'error',
      source: 'node-agent',
      message: 'sidecar crash observed',
      correlationId: 'corr-1',
      traceId: 'trace-1',
      payload: { code: 'sidecar.crashed' }
    })
    const taskResult = formatTaskResult(
      'key-registration-test',
      {
        kind: 'failed',
        failedAt: '2026-06-18T00:00:01.000Z',
        reason: {
          code: 'policy.denied',
          message: 'operation blocked',
          retriable: false
        }
      },
      123,
      { nodeId: 'leaf-a' }
    )

    expect(buffer.flush()).toEqual({
      kind: 'empty',
      reason: 'no_entries'
    })
    expect(taskResult.outcome).toEqual({
      kind: 'failed',
      failedAt: '2026-06-18T00:00:01.000Z',
      reason: {
        code: 'policy.denied',
        message: 'operation blocked',
        retriable: false
      }
    })
  })
})
