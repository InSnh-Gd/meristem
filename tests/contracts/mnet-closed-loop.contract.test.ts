import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  type MNetBreakGlassGrantFromSchema,
  MNetBreakGlassGrantSchema,
  type MNetClosedLoopAuditEvidenceFromSchema,
  MNetCredentialLifecycleResultSchema,
  type MNetEvidenceBundleFromSchema,
  MNetForcedRelayPolicyResultSchema,
  MNetJoinApprovalResultSchema,
  type MNetJoinCredentialFromSchema,
  type MNetPendingJoinRequestFromSchema,
  type MNetPolicyEvidenceFromSchema,
  type MNetProfileMigrationResultFromSchema,
  MNetProfileMigrationResultSchema,
  MNetSidecarStatusSchema,
  MNetTopologyViewSchema
} from '../../packages/contracts/src/index.ts'

const now = '2026-07-07T10:00:00.000Z'
const later = '2026-07-07T10:30:00.000Z'
const tooLate = '2026-07-07T10:31:00.000Z'
const correlationId = 'corr-mnet-closed-loop-001'

function policy(overrides?: Partial<MNetPolicyEvidenceFromSchema>): MNetPolicyEvidenceFromSchema {
  return {
    policyDecisionId: 'pd-mnet-001',
    source: 'm-policy',
    outcome: 'allow',
    requiredPermission: 'network:join',
    reason: 'approved by M-Policy',
    decidedAt: now,
    ...overrides
  }
}

function audit(
  overrides?: Partial<MNetClosedLoopAuditEvidenceFromSchema>
): MNetClosedLoopAuditEvidenceFromSchema {
  return {
    auditId: 'audit-mnet-001',
    source: 'm-log-audit',
    action: 'mnet.join.approve',
    resource: 'network/network-cn-001',
    actor: 'admin',
    result: 'allowed',
    writtenAt: now,
    correlationId,
    ...overrides
  }
}

function evidence(overrides?: {
  policy?: Partial<MNetPolicyEvidenceFromSchema>
  audit?: Partial<MNetClosedLoopAuditEvidenceFromSchema>
}): MNetEvidenceBundleFromSchema {
  return {
    policy: policy(overrides?.policy),
    audit: audit(overrides?.audit),
    log: {
      timelineId: 'timeline-mnet-001',
      fullLogId: 'full-mnet-001',
      eventId: 'evt-mnet-001',
      subject: 'mnet.join.approved.v0',
      correlationId
    }
  }
}

function pendingJoin(
  overrides?: Partial<MNetPendingJoinRequestFromSchema>
): MNetPendingJoinRequestFromSchema {
  return {
    requestId: 'join-request-001',
    networkId: 'network-cn-001',
    nodeId: 'leaf-cn-001',
    requestedNodeKind: 'leaf',
    requestedProfileVersion: 'm-net-cn@0.3.0',
    requestedBy: 'operator',
    status: 'pending',
    requestedAt: now,
    expiresAt: later,
    ...overrides
  }
}

function credential(
  overrides?: Partial<MNetJoinCredentialFromSchema>
): MNetJoinCredentialFromSchema {
  return {
    credentialId: 'join-credential-001',
    nodeId: 'leaf-cn-001',
    networkId: 'network-cn-001',
    profileVersion: 'm-net-cn@0.3.0',
    status: 'issued',
    credentialRef: {
      provider: 'vault-kv-v2',
      keyPath: 'secret/data/mnet/join-credential-001',
      version: 1
    },
    issuedAt: now,
    expiresAt: later,
    ...overrides
  }
}

describe('M-Net closed-loop operation contracts', () => {
  it('join approval requires policy, issues join credential, and carries audit evidence', () => {
    const decoded = Schema.decodeUnknownSync(MNetJoinApprovalResultSchema)({
      result: 'approved',
      request: pendingJoin({ status: 'approved', policyDecisionId: 'pd-mnet-001' }),
      credential: credential(),
      evidence: evidence(),
      correlationId
    })

    expect(decoded.result).toBe('approved')
    if (decoded.result !== 'approved') throw new Error('expected approved join')
    expect(decoded.evidence.policy.source).toBe('m-policy')
    expect(decoded.evidence.audit.source).toBe('m-log-audit')
    expect(decoded.evidence.audit.action).toBe('mnet.join.approve')
    expect(decoded.credential.status).toBe('issued')
  })

  it('join denial produces no join credential and still writes denial audit evidence', () => {
    const decoded = Schema.decodeUnknownSync(MNetJoinApprovalResultSchema)({
      result: 'rejected',
      request: pendingJoin({ status: 'rejected', policyDecisionId: 'pd-mnet-deny' }),
      credential: null,
      policy: policy({
        policyDecisionId: 'pd-mnet-deny',
        outcome: 'deny',
        reason: 'node is outside approved topology'
      }),
      audit: audit({ action: 'mnet.join.reject', result: 'denied' }),
      correlationId
    })

    expect(decoded.result).toBe('rejected')
    if (decoded.result !== 'rejected') throw new Error('expected rejected join')
    expect(decoded.credential).toBeNull()
    expect(decoded.audit.result).toBe('denied')
    expect(decoded.audit.source).toBe('m-log-audit')
  })

  it('credential revocation invalidates existing tunnels and records policy plus audit', () => {
    const decoded = Schema.decodeUnknownSync(MNetCredentialLifecycleResultSchema)({
      result: 'revoked',
      action: 'revoke',
      credential: credential({
        status: 'revoked',
        revokedAt: now,
        revokedByAuditId: 'audit-mnet-revoke'
      }),
      previousCredentialId: 'join-credential-001',
      existingTunnelsInvalidated: true,
      evidence: evidence({
        policy: { requiredPermission: 'network:join', reason: 'credential revoke approved' },
        audit: { auditId: 'audit-mnet-revoke', action: 'mnet.credential.revoke' }
      }),
      correlationId
    })

    expect(decoded.result).toBe('revoked')
    expect(decoded.existingTunnelsInvalidated).toBe(true)
    expect(decoded.evidence.audit.action).toBe('mnet.credential.revoke')
    expect(decoded.evidence.audit.source).toBe('m-log-audit')
  })

  it('rejects credential revocation that leaves existing tunnels valid', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetCredentialLifecycleResultSchema)({
        result: 'revoked',
        action: 'revoke',
        credential: credential({
          status: 'revoked',
          revokedAt: now,
          revokedByAuditId: 'audit-mnet-revoke'
        }),
        previousCredentialId: 'join-credential-001',
        existingTunnelsInvalidated: false,
        evidence: evidence({
          policy: { requiredPermission: 'node:issue-token' },
          audit: { auditId: 'audit-mnet-revoke', action: 'mnet.credential.revoke' }
        }),
        correlationId
      })
    ).toThrow()
  })

  it('forced relay without permission is denied with no side effect', () => {
    const decoded = Schema.decodeUnknownSync(MNetForcedRelayPolicyResultSchema)({
      result: 'denied',
      reason: 'missing network relay policy permission',
      policy: policy({
        policyDecisionId: 'pd-mnet-relay-deny',
        outcome: 'deny',
        requiredPermission: 'network:profile-enable'
      }),
      audit: audit({ action: 'mnet.relay_policy.deny', result: 'denied' }),
      sideEffect: 'none',
      correlationId
    })

    expect(decoded.result).toBe('denied')
    if (decoded.result !== 'denied') throw new Error('expected relay denial')
    expect(decoded.sideEffect).toBe('none')
    expect(decoded.audit.result).toBe('denied')
  })

  it('forced relay with approval enables relay policy and carries audit evidence', () => {
    const decoded = Schema.decodeUnknownSync(MNetForcedRelayPolicyResultSchema)({
      result: 'enabled',
      relayPolicyId: 'relay-policy-001',
      networkId: 'network-cn-001',
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional egress degraded',
      affectedNodeIds: ['leaf-cn-001'],
      evidence: evidence({
        policy: { requiredPermission: 'network:profile-enable', reason: 'relay policy approved' },
        audit: { action: 'mnet.relay_policy.enable' }
      }),
      correlationId
    })

    expect(decoded.result).toBe('enabled')
    if (decoded.result !== 'enabled') throw new Error('expected relay enabled')
    expect(decoded.state).toBe('enabled')
    expect(decoded.evidence.policy.source).toBe('m-policy')
    expect(decoded.evidence.audit.source).toBe('m-log-audit')
  })

  it('rejects a forced relay result whose state contradicts the applied result', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetForcedRelayPolicyResultSchema)({
        result: 'enabled',
        relayPolicyId: 'relay-policy-001',
        networkId: 'network-cn-001',
        state: 'denied',
        routeClass: 'forced-tcp-relay',
        selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
        reason: 'regional egress degraded',
        affectedNodeIds: ['leaf-cn-001'],
        evidence: evidence({
          policy: { requiredPermission: 'network:profile-enable' },
          audit: { action: 'mnet.relay_policy.enable' }
        }),
        correlationId
      })
    ).toThrow()
  })

  it('sidecar degraded is a typed UI-facing fact and is not healthy', () => {
    const decoded = Schema.decodeUnknownSync(MNetSidecarStatusSchema)({
      nodeId: 'leaf-cn-001',
      desiredState: 'start',
      healthStatus: 'degraded',
      degradedReason: 'netbird.config.missing_control_plane',
      proofPath: 'sidecar-proof',
      fallbackTransport: 'wireguard-rendered',
      uiFacingFact: true,
      healthy: false,
      checkedAt: now
    })

    expect(decoded.uiFacingFact).toBe(true)
    expect(decoded.healthy).toBe(false)
    expect(decoded.degradedReason).toBe('netbird.config.missing_control_plane')
    expect(decoded.fallbackTransport).toBe('wireguard-rendered')
  })

  it('rejects a degraded sidecar fact that claims healthy or omits its reason', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetSidecarStatusSchema)({
        nodeId: 'leaf-cn-001',
        desiredState: 'start',
        healthStatus: 'degraded',
        proofPath: 'runtime-probe',
        uiFacingFact: true,
        healthy: true,
        checkedAt: now
      })
    ).toThrow()
  })

  it('profile migration records state transition and rollback path', () => {
    const decoded: MNetProfileMigrationResultFromSchema = Schema.decodeUnknownSync(
      MNetProfileMigrationResultSchema
    )({
      migrationId: 'migration-001',
      networkId: 'network-cn-001',
      sourceProfileVersion: 'm-net-cn@0.2.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      state: 'rollback_available',
      appliedNetworkIds: ['network-cn-001'],
      rollbackProfileVersion: 'm-net-cn@0.2.0',
      rollbackState: 'available',
      evidence: evidence({
        policy: {
          requiredPermission: 'network:profile-enable',
          reason: 'profile migration approved'
        },
        audit: { action: 'mnet.profile.migration.apply' }
      }),
      correlationId
    })

    expect(decoded.state).toBe('rollback_available')
    expect(decoded.rollbackState).toBe('available')
    expect(decoded.sourceProfileVersion).toBe('m-net-cn@0.2.0')
    expect(decoded.evidence.audit.source).toBe('m-log-audit')
  })

  it('rejects an unversioned profile migration source and rollback path', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetProfileMigrationResultSchema)({
        migrationId: 'migration-001',
        networkId: 'network-cn-001',
        sourceProfileVersion: 'legacy-profile',
        targetProfileVersion: 'm-net-cn@0.3.0',
        state: 'rollback_available',
        appliedNetworkIds: ['network-cn-001'],
        rollbackProfileVersion: 'legacy-profile',
        rollbackState: 'available',
        evidence: evidence({
          policy: { requiredPermission: 'network:profile-enable' },
          audit: { action: 'mnet.profile.migration.apply' }
        }),
        correlationId
      })
    ).toThrow()
  })

  it('break-glass TTL expiry auto-revokes grant and requires normal approval afterward', () => {
    const decoded: MNetBreakGlassGrantFromSchema = Schema.decodeUnknownSync(
      MNetBreakGlassGrantSchema
    )({
      grantId: 'break-glass-001',
      networkId: 'network-cn-001',
      initiatedBy: 'security-admin',
      secondApprover: 'break-glass-reviewer',
      state: 'auto_revoked',
      ttlMinutes: 30,
      initiatedAt: now,
      expiresAt: later,
      autoRevokedAt: later,
      requiresNormalApprovalAfterExpiry: true,
      evidence: evidence({
        policy: {
          requiredPermission: 'network:profile-disable',
          reason: 'independent break-glass approval recorded'
        },
        audit: {
          action: 'mnet.break_glass.auto_revoke',
          actor: 'security-admin',
          result: 'auto-revoked'
        }
      }),
      correlationId
    })

    expect(decoded.state).toBe('auto_revoked')
    expect(decoded.ttlMinutes).toBe(30)
    expect(decoded.requiresNormalApprovalAfterExpiry).toBe(true)
    expect(decoded.secondApprover).toBe('break-glass-reviewer')
    expect(decoded.evidence.policy.source).toBe('m-policy')
    expect(decoded.evidence.audit.source).toBe('m-log-audit')
  })

  it('rejects break-glass auto-revoke without an independent second approval', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetBreakGlassGrantSchema)({
        grantId: 'break-glass-001',
        networkId: 'network-cn-001',
        initiatedBy: 'security-admin',
        state: 'auto_revoked',
        ttlMinutes: 30,
        initiatedAt: now,
        expiresAt: later,
        autoRevokedAt: later,
        requiresNormalApprovalAfterExpiry: true,
        evidence: evidence({
          policy: {
            requiredPermission: 'network:profile-disable',
            reason: 'missing independent approval'
          },
          audit: {
            action: 'mnet.break_glass.auto_revoke',
            actor: 'security-admin',
            result: 'auto-revoked'
          }
        }),
        correlationId
      })
    ).toThrow()
  })

  it('rejects break-glass expiry that exceeds the fixed 30-minute TTL', () => {
    expect(() =>
      Schema.decodeUnknownSync(MNetBreakGlassGrantSchema)({
        grantId: 'break-glass-001',
        networkId: 'network-cn-001',
        initiatedBy: 'security-admin',
        secondApprover: 'break-glass-reviewer',
        state: 'auto_revoked',
        ttlMinutes: 30,
        initiatedAt: now,
        expiresAt: tooLate,
        autoRevokedAt: tooLate,
        requiresNormalApprovalAfterExpiry: true,
        evidence: evidence({
          policy: { requiredPermission: 'network:profile-disable' },
          audit: { action: 'mnet.break_glass.auto_revoke', result: 'auto-revoked' }
        }),
        correlationId
      })
    ).toThrow()
  })

  it('topology view normalizes maps and keys into Meristem-owned profile and credential terms', () => {
    const sidecar = Schema.decodeUnknownSync(MNetSidecarStatusSchema)({
      nodeId: 'leaf-cn-001',
      desiredState: 'start',
      healthStatus: 'healthy',
      proofPath: 'runtime-probe',
      uiFacingFact: true,
      healthy: true,
      checkedAt: now
    })

    const decoded = Schema.decodeUnknownSync(MNetTopologyViewSchema)({
      contractVersion: 'mnet-closed-loop@0.1.0',
      generatedAt: now,
      stateSource: 'composed-ui-fact',
      networks: [
        {
          networkId: 'network-cn-001',
          displayName: 'China production overlay',
          profileVersion: 'm-net-cn@0.3.0',
          status: 'healthy',
          mapStatus: {
            mapId: 'topology-map-001',
            networkId: 'network-cn-001',
            topologyRevision: 'rev-001',
            signedBy: 'm-net',
            issuedAt: now,
            expiresAt: later,
            freshness: 'fresh',
            stateSource: 'nats-kv-cache',
            validation: 'valid'
          },
          relayPolicyState: 'disabled'
        }
      ],
      nodes: [
        {
          nodeId: 'leaf-cn-001',
          nodeKind: 'leaf',
          runtimeState: 'healthy',
          profileVersion: 'm-net-cn@0.3.0',
          sidecar,
          credentialStatus: 'active',
          keyStatus: {
            nodeId: 'leaf-cn-001',
            publicKeyFingerprint: 'sha256:abc123',
            status: 'registered',
            lastValidatedAt: now,
            auditId: 'audit-key-001'
          }
        }
      ],
      profiles: ['m-net-cn@0.3.0'],
      tunnelHealth: [
        {
          nodeId: 'leaf-cn-001',
          peerNodeId: 'stem-cn-001',
          status: 'up',
          mode: 'direct',
          latencyMs: 20,
          packetLossPct: 0,
          relayStatus: 'not-required',
          checkedAt: now,
          stateSource: 'opensearch-projection'
        }
      ],
      sidecarStatuses: [sidecar],
      degraded: false,
      correlationId
    })

    expect(decoded.networks[0]?.profileVersion).toBe('m-net-cn@0.3.0')
    expect(decoded.nodes[0]?.credentialStatus).toBe('active')
    expect(decoded.tunnelHealth[0]?.mode).toBe('direct')
  })
})
