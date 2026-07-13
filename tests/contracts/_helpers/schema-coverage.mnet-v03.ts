import type { EventContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

const netbirdConfigRef = { configRef: 'config/netbird/signal' } as const
const netbirdRelayConfigRef = { configRef: 'config/netbird/relay' } as const
const netbirdStunConfigRef = { configRef: 'config/netbird/stun' } as const
const now = '2026-07-07T10:00:00.000Z'
const later = '2026-07-07T10:30:00.000Z'
const correlationId = 'corr-mnet-closed-loop-coverage'

const policy = {
  policyDecisionId: 'pd-mnet-coverage',
  source: 'm-policy',
  outcome: 'allow',
  requiredPermission: 'network:join',
  reason: 'fixture approval',
  decidedAt: now
} as const

const audit = {
  auditId: 'audit-mnet-coverage',
  source: 'm-log-audit',
  action: 'mnet.join.approve',
  resource: 'network/network-cn-001',
  actor: 'admin',
  result: 'allowed',
  writtenAt: now,
  correlationId
} as const

const evidence = {
  policy,
  audit,
  log: {
    timelineId: 'timeline-mnet-coverage',
    fullLogId: 'full-mnet-coverage',
    eventId: 'evt-mnet-coverage',
    subject: 'mnet.join.approved.v0',
    correlationId
  }
} as const

const pendingJoin = {
  requestId: 'join-request-coverage',
  networkId: 'network-cn-001',
  nodeId: 'leaf-cn-001',
  requestedNodeKind: 'leaf',
  requestedProfileVersion: 'm-net-cn@0.3.0',
  requestedBy: 'operator',
  status: 'pending',
  requestedAt: now,
  expiresAt: later,
  policyDecisionId: 'pd-mnet-coverage'
} as const

const credential = {
  credentialId: 'join-credential-coverage',
  nodeId: 'leaf-cn-001',
  networkId: 'network-cn-001',
  profileVersion: 'm-net-cn@0.3.0',
  status: 'issued',
  credentialRef: { provider: 'vault-kv-v2', keyPath: 'secret/data/mnet/join-coverage', version: 1 },
  issuedAt: now,
  expiresAt: later
} as const

const sidecar = {
  nodeId: 'leaf-cn-001',
  desiredState: 'start',
  healthStatus: 'healthy',
  proofPath: 'runtime-probe',
  uiFacingFact: true,
  healthy: true,
  checkedAt: now
} as const

const mapStatus = {
  mapId: 'topology-map-coverage',
  networkId: 'network-cn-001',
  topologyRevision: 'rev-coverage',
  signedBy: 'm-net',
  issuedAt: now,
  expiresAt: later,
  freshness: 'fresh',
  stateSource: 'nats-kv-cache',
  validation: 'valid'
} as const

const tunnelHealth = {
  nodeId: 'leaf-cn-001',
  peerNodeId: 'stem-cn-001',
  status: 'up',
  mode: 'direct',
  latencyMs: 20,
  packetLossPct: 0,
  relayStatus: 'not-required',
  checkedAt: now,
  stateSource: 'opensearch-projection'
} as const

const topologyView = {
  contractVersion: 'mnet-closed-loop@0.1.0',
  generatedAt: now,
  stateSource: 'composed-ui-fact',
  networks: [
    {
      networkId: 'network-cn-001',
      displayName: 'China production overlay',
      profileVersion: 'm-net-cn@0.3.0',
      status: 'healthy',
      mapStatus,
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
        auditId: 'audit-key-coverage'
      }
    }
  ],
  profiles: ['m-net-cn@0.3.0'],
  tunnelHealth: [tunnelHealth],
  sidecarStatuses: [sidecar],
  degraded: false,
  correlationId
} as const

export const mnetV03EventContracts: EventContract[] = [
  {
    subject: 'mnet.sidecar.lifecycle.v0',
    schema: Contracts.MNetSidecarLifecycleEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      previousDesiredState: 'configure',
      desiredState: 'start',
      credentialStatus: 'ready',
      signalConfigRef: netbirdConfigRef,
      relayConfigRef: netbirdRelayConfigRef,
      stunConfigRef: netbirdStunConfigRef,
      correlationId: 'corr-sidecar-lifecycle-1',
      auditId: 'audit-sidecar-lifecycle-1'
    }
  },
  {
    subject: 'mnet.sidecar.health.v0',
    schema: Contracts.MNetSidecarHealthEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      healthStatus: 'healthy',
      previousHealthStatus: 'degraded',
      signalReachable: true,
      relayReachable: true,
      stunReachable: true,
      checkedAt: '2026-06-30T10:00:00.000Z',
      correlationId: 'corr-sidecar-health-1'
    }
  },
  {
    subject: 'mnet.topology.update.v0',
    schema: Contracts.MNetTopologyUpdateEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      profileVersion: 'm-net@0.3.0',
      topologyRevision: 'topology-42',
      routeClass: 'standard',
      sidecarDesiredState: 'start',
      affectedNodeIds: ['node-v03-1', 'node-v03-2'],
      policyDecisionId: 'pd-topology-1',
      auditId: 'audit-topology-1',
      correlationId: 'corr-topology-1'
    }
  },
  {
    subject: 'mnet.migration.required.v0',
    schema: Contracts.MNetMigrationRequiredEventPayloadSchema,
    fixture: {
      resourceKind: 'profile',
      networkId: 'net-cn-legacy',
      policyDecisionId: 'pd-migration-1',
      auditId: 'audit-migration-1',
      correlationId: 'corr-migration-1',
      migration: {
        code: 'migration_required',
        message: 'wstunnel production profile must migrate to NetBird CN profile v0.3.0',
        targetProfileVersion: 'm-net-cn@0.3.0',
        rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
        affectedProfileIds: ['m-net-cn@0.2.0'],
        affectedNodeIds: ['node-cn-1'],
        reasonCode: 'legacy_wstunnel_profile_v0_2'
      }
    }
  },
  {
    subject: 'mnet.forced_relay.change.v0',
    schema: Contracts.MNetForcedRelayChangeEventPayloadSchema,
    fixture: {
      networkId: 'net-cn-v03',
      profileVersion: 'm-net-cn@0.3.0',
      routeClass: 'forced-tcp-relay',
      selectorOwnership: 'policy',
      selector: {
        selectorType: 'label-selector',
        matchLabels: { region: 'cn' }
      },
      operatorOverrideActive: false,
      policyDecisionId: 'pd-relay-1',
      auditId: 'audit-relay-1',
      eventId: 'evt-relay-1',
      affectedNodeIds: ['node-cn-1', 'node-cn-2'],
      correlationId: 'corr-relay-change-1'
    }
  },
  {
    subject: 'mnet.credential.expiry.v0',
    schema: Contracts.MNetCredentialExpiryEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      credentialRef: {
        provider: 'vault-kv-v2',
        keyPath: 'meristem/netbird/node-v03-1',
        version: 3
      },
      credentialStatus: 'rotation_required',
      expiresAt: '2026-07-01T10:00:00.000Z',
      correlationId: 'corr-credential-expiry-1',
      auditId: 'audit-credential-expiry-1'
    }
  },
  {
    subject: 'mnet.join.requested.v0',
    schema: Contracts.MNetPendingJoinRequestSchema,
    fixture: pendingJoin
  },
  {
    subject: 'mnet.join.approved.v0',
    schema: Contracts.MNetJoinApprovalGrantedSchema,
    fixture: {
      result: 'approved',
      request: { ...pendingJoin, status: 'approved' },
      credential,
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.join.rejected.v0',
    schema: Contracts.MNetJoinApprovalRejectedSchema,
    fixture: {
      result: 'rejected',
      request: { ...pendingJoin, status: 'rejected' },
      credential: null,
      policy: { ...policy, outcome: 'deny', reason: 'fixture denial' },
      audit: { ...audit, action: 'mnet.join.reject', result: 'denied' },
      correlationId
    }
  },
  {
    subject: 'mnet.credential.issued.v0',
    schema: Contracts.MNetCredentialLifecycleResultSchema,
    fixture: {
      result: 'issued',
      action: 'issue',
      credential,
      existingTunnelsInvalidated: false,
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.credential.rotated.v0',
    schema: Contracts.MNetCredentialLifecycleResultSchema,
    fixture: {
      result: 'rotated',
      action: 'rotate',
      credential: {
        ...credential,
        status: 'issued',
        rotatedFromCredentialId: 'join-credential-previous'
      },
      previousCredentialId: 'join-credential-previous',
      existingTunnelsInvalidated: true,
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.credential.revoked.v0',
    schema: Contracts.MNetCredentialLifecycleResultSchema,
    fixture: {
      result: 'revoked',
      action: 'revoke',
      credential: {
        ...credential,
        status: 'revoked',
        revokedAt: now,
        revokedByAuditId: 'audit-revoke'
      },
      previousCredentialId: 'join-credential-coverage',
      existingTunnelsInvalidated: true,
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.topology.view.updated.v0',
    schema: Contracts.MNetTopologyViewSchema,
    fixture: topologyView
  },
  {
    subject: 'mnet.topology.map.status.v0',
    schema: Contracts.MNetSignedTopologyMapStatusSchema,
    fixture: mapStatus
  },
  {
    subject: 'mnet.tunnel.health.v0',
    schema: Contracts.MNetTunnelHealthSchema,
    fixture: tunnelHealth
  },
  {
    subject: 'mnet.relay_policy.changed.v0',
    schema: Contracts.MNetForcedRelayPolicyResultSchema,
    fixture: {
      result: 'enabled',
      relayPolicyId: 'relay-policy-coverage',
      networkId: 'network-cn-001',
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional egress degraded',
      affectedNodeIds: ['leaf-cn-001'],
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.profile.migration.changed.v0',
    schema: Contracts.MNetProfileMigrationResultSchema,
    fixture: {
      migrationId: 'migration-coverage',
      networkId: 'network-cn-001',
      sourceProfileVersion: 'm-net-cn@0.2.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      state: 'rollback_available',
      appliedNetworkIds: ['network-cn-001'],
      rollbackProfileVersion: 'm-net-cn@0.2.0',
      rollbackState: 'available',
      evidence,
      correlationId
    }
  },
  {
    subject: 'mnet.break_glass.changed.v0',
    schema: Contracts.MNetBreakGlassGrantSchema,
    fixture: {
      grantId: 'break-glass-coverage',
      networkId: 'network-cn-001',
      initiatedBy: 'security-admin',
      secondApprover: 'break-glass-reviewer',
      state: 'auto_revoked',
      ttlMinutes: 30,
      initiatedAt: now,
      expiresAt: later,
      autoRevokedAt: later,
      requiresNormalApprovalAfterExpiry: true,
      evidence: {
        ...evidence,
        policy: {
          ...policy,
          requiredPermission: 'network:profile-disable',
          reason: 'independent break-glass approval recorded'
        },
        audit: {
          ...audit,
          action: 'mnet.break_glass.auto_revoke',
          actor: 'security-admin',
          result: 'auto-revoked'
        }
      },
      correlationId
    }
  },
  {
    subject: 'mnet.sidecar.degraded.v0',
    schema: Contracts.MNetSidecarDegradedStatusSchema,
    fixture: {
      ...sidecar,
      healthStatus: 'degraded',
      degradedReason: 'netbird.config.missing_control_plane',
      proofPath: 'sidecar-proof',
      fallbackTransport: 'wireguard-rendered',
      healthy: false
    }
  }
]
