import { describe, expect, it } from 'bun:test'
import type {
  ActorId,
  MNetHistoricalProfileVersionFromSchema,
  MNetProfileV03VersionFromSchema,
  NodeAgentRuntimeStatus
} from '../../../packages/contracts/src/index.ts'
import { createInMemoryDataPlaneStores } from '../../../services/m-net/src/data-plane-store-memory.ts'
import { createInMemoryMNetClosedLoopStore } from '../../../services/m-net/src/closed-loop-store-memory.ts'
import {
  createMNetClosedLoopService,
  projectNodeAgentSidecarStatus
} from '../../../services/m-net/src/closed-loop-workflow.ts'

const networkId = 'network-cn-closed-loop'
const nodeId = 'leaf-cn-closed-loop'
const profileVersion = 'm-net-cn@0.3.0' as const
const startedAt = '2026-07-21T10:00:00.000Z'

type PolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

function createFixture(input?: { policyResult?: PolicyResult; now?: string }) {
  const calls: string[] = []
  const events: Array<{ subject: string; payload: unknown }> = []
  const audits: Array<{ action: string; result: string }> = []
  const store = createInMemoryMNetClosedLoopStore()
  const dataPlane = createInMemoryDataPlaneStores()
  let policyResult = input?.policyResult ?? 'allow'
  let now = input?.now ?? startedAt

  const service = createMNetClosedLoopService({
    store,
    dataPlane,
    now: () => new Date(now),
    id: prefix => `${prefix}-${crypto.randomUUID()}`,
    policy: {
      async authorize(_actor, action) {
        calls.push(`policy:${action}`)
        return {
          result: policyResult,
          id: `policy-${action}`,
          reasons: policyResult === 'allow' ? ['allowed by fixture'] : ['denied by fixture']
        }
      }
    },
    log: {
      async writeAudit(_actor, action, _resource, result) {
        calls.push(`audit:${action}:${result}`)
        audits.push({ action, result })
      },
      async writeTimeline() {},
      async writeFull() {}
    },
    events: {
      async publish(subject, _type, payload) {
        calls.push(`event:${subject}`)
        events.push({ subject, payload })
      }
    },
    credentials: {
      async issue(input) {
        calls.push(`secret:issue:${input.credentialId}`)
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: `secret/data/mnet/join/${input.credentialId}`,
            version: 1
          }
        }
      },
      async rotate(input) {
        calls.push(`secret:rotate:${input.credentialId}`)
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: `secret/data/mnet/join/${input.credentialId}`,
            version: 2
          }
        }
      },
      async revoke(input) {
        calls.push(`secret:revoke:${input.credentialId}`)
        return { ok: true }
      }
    },
    network: {
      async listNetworks() {
        return {
          ok: true,
          value: [
            {
              id: networkId,
              name: 'CN closed-loop overlay',
              profileVersion,
              status: 'active',
              createdAt: startedAt,
              memberCount: 1
            }
          ]
        }
      },
      async listMembers() {
        return {
          ok: true,
          value: [
            {
              networkId,
              nodeId,
              nodeKind: 'leaf',
              membershipMode: 'restricted',
              status: 'joined',
              joinedAt: startedAt
            }
          ]
        }
      }
    },
    migration: {
      async apply(input) {
        calls.push(`mutation:migration:apply:${input.networkId}`)
        return { ok: true, appliedNetworkIds: [input.networkId] }
      },
      async rollback(input) {
        calls.push(`mutation:migration:rollback:${input.networkId}`)
        return { ok: true, appliedNetworkIds: [] }
      }
    },
    onMutation(kind) {
      calls.push(`mutation:${kind}`)
    }
  })

  return {
    service,
    store,
    dataPlane,
    calls,
    events,
    audits,
    setPolicyResult(value: PolicyResult) {
      policyResult = value
    },
    setNow(value: string) {
      now = value
    }
  }
}

async function submitJoin(
  fixture: ReturnType<typeof createFixture>,
  requestedBy: ActorId = 'operator'
) {
  const result = await fixture.service.submitJoinRequest({
    requestId: `join-${crypto.randomUUID()}`,
    networkId,
    nodeId,
    requestedNodeKind: 'leaf',
    requestedProfileVersion: profileVersion,
    requestedBy,
    expiresAt: '2026-07-21T11:00:00.000Z',
    correlationId: `correlation-${crypto.randomUUID()}`
  })
  if (!('kind' in result) || result.kind !== 'mutation') {
    throw new Error('expected submitted join mutation')
  }
  return result.value
}

describe('M-Net closed-loop workflows', () => {
  it('approves or explicitly rejects joins only after policy and Audit', async () => {
    const approvedFixture = createFixture()
    const approvedRequest = await submitJoin(approvedFixture)
    approvedFixture.calls.length = 0
    const approved = await approvedFixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: approvedRequest.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-22T10:00:00.000Z'
    })

    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected approved mutation')
    }
    expect(approved.value.result).toBe('approved')
    expect(approvedFixture.calls.slice(0, 4).map(call => call.split(':')[0])).toEqual([
      'policy',
      'audit',
      'secret',
      'mutation'
    ])
    expect(approvedFixture.events.map(event => event.subject)).toContain('mnet.join.approved.v0')
    expect(approvedFixture.events.map(event => event.subject)).toContain(
      'mnet.credential.issued.v0'
    )

    const rejectedFixture = createFixture()
    const rejectedRequest = await submitJoin(rejectedFixture)
    rejectedFixture.calls.length = 0
    const rejected = await rejectedFixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: rejectedRequest.requestId,
      decision: 'reject',
      reason: 'node is outside approved topology'
    })

    expect(rejected).toMatchObject({
      kind: 'mutation',
      value: { result: 'rejected', credential: null }
    })
    expect(await rejectedFixture.store.credentials.listByNetwork(networkId)).toEqual([])
    expect(rejectedFixture.calls.some(call => call.startsWith('secret:'))).toBe(false)
    expect(rejectedFixture.calls.indexOf('mutation:join-rejected')).toBeGreaterThan(
      rejectedFixture.calls.findIndex(call => call.startsWith('audit:'))
    )
  })

  it('revokes credential eligibility and invalidates existing tunnels after policy and Audit', async () => {
    const fixture = createFixture()
    const request = await submitJoin(fixture)
    const approved = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: request.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-22T10:00:00.000Z'
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected approved join')
    }
    if (approved.value.result !== 'approved') throw new Error('expected approved join')

    expect(await fixture.service.isTunnelEligible(networkId, nodeId)).toBe(true)
    fixture.calls.length = 0
    const revoked = await fixture.service.revokeCredential({
      actor: 'security-admin',
      credentialId: approved.value.credential.credentialId,
      reason: 'node compromise'
    })

    expect(revoked).toMatchObject({
      kind: 'mutation',
      value: { result: 'revoked', existingTunnelsInvalidated: true }
    })
    expect(await fixture.service.isTunnelEligible(networkId, nodeId)).toBe(false)
    expect(fixture.calls.map(call => call.split(':')[0]).slice(0, 4)).toEqual([
      'policy',
      'audit',
      'secret',
      'mutation'
    ])
    expect(fixture.events.at(-1)?.subject).toBe('mnet.credential.revoked.v0')
  })

  it('rotates credentials through a fail-closed transition and invalidates the previous secret', async () => {
    const fixture = createFixture()
    const request = await submitJoin(fixture)
    const approved = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: request.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-22T10:00:00.000Z'
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected approved join')
    }
    if (approved.value.result !== 'approved') throw new Error('expected approved join')

    fixture.calls.length = 0
    const rotated = await fixture.service.rotateCredential({
      actor: 'security-admin',
      credentialId: approved.value.credential.credentialId,
      expiresAt: '2026-07-23T10:00:00.000Z',
      reason: 'scheduled rotation'
    })
    if (!('kind' in rotated) || rotated.kind !== 'mutation') {
      throw new Error('expected rotated credential mutation')
    }

    expect(rotated.value).toMatchObject({
      result: 'rotated',
      previousCredentialId: approved.value.credential.credentialId,
      existingTunnelsInvalidated: true
    })
    expect(
      await fixture.store.credentials.get(approved.value.credential.credentialId)
    ).toMatchObject({ status: 'revoked' })
    expect(await fixture.service.isTunnelEligible(networkId, nodeId)).toBe(true)
    expect(fixture.calls.some(call => call.startsWith('secret:revoke:'))).toBe(true)
    expect(fixture.events.at(-1)?.subject).toBe('mnet.credential.rotated.v0')
  })

  it('returns forced-relay denial with sideEffect none and leaves authoritative state unchanged', async () => {
    const fixture = createFixture({ policyResult: 'deny' })
    const result = await fixture.service.changeRelayPolicy({
      actor: 'operator',
      networkId,
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional egress degraded',
      affectedNodeIds: [nodeId]
    })

    expect(result).toMatchObject({ result: 'denied', sideEffect: 'none' })
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
    expect(fixture.calls.some(call => call.startsWith('mutation:relay-policy'))).toBe(false)
    expect(fixture.audits.at(-1)?.result).toBe('denied')
    expect(fixture.events).toEqual([])
  })

  it('projects degraded node-agent runtime as typed, UI-facing, non-healthy sidecar fact', () => {
    const runtime: NodeAgentRuntimeStatus = {
      kind: 'degraded',
      desiredState: 'start',
      credentialStatus: 'ready',
      healthStatus: 'degraded',
      observedHealth: 'degraded',
      correlationId: 'correlation-sidecar-degraded',
      observedAt: startedAt,
      dependencies: { signal: 'unavailable', relay: 'ready', stun: 'ready' },
      degradedReasons: [
        { code: 'netbird.probe.failed', message: 'NetBird peer session is unavailable' }
      ]
    }

    const projected = projectNodeAgentSidecarStatus(nodeId, runtime, {
      proofPath: 'runtime-probe',
      fallbackTransport: 'wireguard-rendered'
    })

    expect(projected).toMatchObject({
      nodeId,
      healthStatus: 'degraded',
      degradedReason: 'wireguard_rendered_fallback',
      fallbackTransport: 'wireguard-rendered',
      uiFacingFact: true,
      healthy: false
    })
  })

  it('keeps signed map, key, tunnel, credential, and sidecar facts visible in topology', async () => {
    const fixture = createFixture()
    const request = await submitJoin(fixture)
    const approved = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: request.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-22T10:00:00.000Z'
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected approved join')
    }
    if (approved.value.result !== 'approved') throw new Error('expected approved join')

    await fixture.dataPlane.networkMaps.save({
      networkId,
      mapVersion: 7,
      profileVersion,
      map: {
        networkId,
        profileVersion,
        members: [],
        aclRules: [],
        expiresAt: Date.parse('2026-07-21T10:15:00.000Z'),
        mapVersion: 7,
        signatureMetadata: {
          algorithm: 'ed25519',
          keyId: 'm-net-map-key-1',
          publicKey: 'public-map-key',
          value: 'signed-map-value'
        }
      },
      signatureMetadata: { keyId: 'm-net-map-key-1' },
      expiresAt: '2026-07-21T10:15:00.000Z',
      publishedAt: startedAt
    })
    await fixture.dataPlane.nodePublicKeys.upsert({
      nodeId,
      keyId: 'node-key-1',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      fingerprint: 'sha256:node-key-fingerprint',
      algorithm: 'wireguard-x25519',
      createdAt: startedAt,
      rotationCounter: 0,
      status: 'active'
    })
    await fixture.service.recordSidecarStatus({
      networkId,
      status: {
        nodeId,
        desiredState: 'start',
        healthStatus: 'healthy',
        proofPath: 'runtime-probe',
        uiFacingFact: true,
        healthy: true,
        checkedAt: startedAt
      }
    })
    await fixture.service.recordTunnelHealth({
      networkId,
      health: {
        nodeId,
        peerNodeId: 'stem-cn-closed-loop',
        status: 'up',
        mode: 'direct',
        relayStatus: 'not-required',
        checkedAt: startedAt,
        stateSource: 'opensearch-projection'
      }
    })

    const topology = await fixture.service.getTopologyView({
      actor: 'operator',
      networkId,
      correlationId: 'correlation-topology-view'
    })
    if ('kind' in topology) throw new Error(topology.error.message)

    expect(topology.networks[0]?.mapStatus).toMatchObject({
      topologyRevision: '7',
      signedBy: 'm-net-map-key-1',
      freshness: 'fresh',
      validation: 'valid'
    })
    expect(topology.nodes[0]?.keyStatus).toMatchObject({
      publicKeyFingerprint: 'sha256:node-key-fingerprint',
      status: 'registered'
    })
    expect(topology.nodes[0]?.credentialStatus).toBe('issued')
    expect(topology.tunnelHealth).toHaveLength(1)
    expect(topology.degraded).toBe(false)
  })

  it('publishes profile migration rollback visibility from the committed result contract', async () => {
    const fixture = createFixture()
    const sourceProfileVersion: MNetHistoricalProfileVersionFromSchema = 'm-net-cn@0.2.0'
    const targetProfileVersion: MNetProfileV03VersionFromSchema = profileVersion
    const applied = await fixture.service.migrateProfile({
      actor: 'admin',
      networkId,
      sourceProfileVersion,
      targetProfileVersion,
      reason: 'move to committed sidecar profile'
    })
    if (!('kind' in applied) || applied.kind !== 'mutation') {
      throw new Error('expected applied migration')
    }

    expect(applied.value).toMatchObject({
      state: 'rollback_available',
      rollbackProfileVersion: sourceProfileVersion,
      rollbackState: 'available'
    })

    const rolledBack = await fixture.service.rollbackProfile({
      actor: 'admin',
      migrationId: applied.value.migrationId,
      reason: 'runtime proof failed'
    })
    if (!('kind' in rolledBack) || rolledBack.kind !== 'mutation') {
      throw new Error('expected rolled back migration')
    }

    expect(rolledBack.value).toMatchObject({ state: 'rolled_back', rollbackState: 'completed' })
    expect(
      fixture.events.filter(event => event.subject === 'mnet.profile.migration.changed.v0')
    ).toHaveLength(2)
  })

  it('requires two people, enforces exact 30-minute TTL, and auto-revokes before expiry mutation', async () => {
    const fixture = createFixture()
    const initiated = await fixture.service.initiateBreakGlass({
      actor: 'security-admin',
      networkId,
      reason: 'isolate compromised overlay'
    })
    if (!('kind' in initiated) || initiated.kind !== 'mutation') {
      throw new Error('expected initiated break-glass')
    }

    expect(Date.parse(initiated.value.expiresAt) - Date.parse(initiated.value.initiatedAt)).toBe(
      30 * 60 * 1000
    )
    expect(initiated.value.state).toBe('second_approval_pending')

    const approved = await fixture.service.approveBreakGlass({
      actor: 'break-glass-reviewer',
      grantId: initiated.value.grantId
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected approved break-glass')
    }
    expect(approved.value.state).toBe('active')

    fixture.calls.length = 0
    fixture.setNow('2026-07-21T10:30:00.000Z')
    const expired = await fixture.service.enforceBreakGlassExpiry(initiated.value.grantId)
    if (!('kind' in expired) || expired.kind !== 'mutation') {
      throw new Error('expected expired break-glass mutation')
    }

    expect(expired.value).toMatchObject({
      state: 'auto_revoked',
      autoRevokedAt: '2026-07-21T10:30:00.000Z',
      requiresNormalApprovalAfterExpiry: true
    })
    expect(fixture.calls.findIndex(call => call.startsWith('audit:'))).toBeLessThan(
      fixture.calls.indexOf('mutation:break-glass-auto-revoked')
    )
    expect(await fixture.service.isBreakGlassActive(initiated.value.grantId)).toBe(false)
    expect(fixture.events.at(-1)?.subject).toBe('mnet.break_glass.changed.v0')
  })
})
