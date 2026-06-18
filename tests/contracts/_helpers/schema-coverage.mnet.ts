import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

const dataPlaneMembers = [
  {
    nodeId: 'node-1',
    tunnelIp: '100.64.0.10',
    publicKeyFingerprint: 'wg-fp-node-1'
  }
] as const

const networkMapRelayAssignment = {
  relayType: 'wstunnel',
  relayEndpoint: 'wss://relay.cn.example/mnet',
  nodeIds: ['node-1']
} as const

const nodeRelayAssignment = {
  nodeId: 'node-1',
  relayEndpoint: 'wss://relay.cn.example/mnet',
  relayType: 'wstunnel'
} as const

const dataPlaneAclRules = [
  {
    ruleId: 'acl-1',
    action: 'allow',
    sourceNodeId: 'node-1',
    targetNodeId: 'node-2',
    protocol: 'any'
  }
] as const

const productionRuntimeConfig = {
  headscaleEndpoint: { secretRefId: 'secret-headscale-cn' },
  routingTable: { secretRefId: 'secret-routing-cn' }
} as const

const productionCnProfile = {
  profileVersion: 'm-net-cn@0.2.0',
  region: 'cn',
  displayName: 'M-Net CN (Production Data Plane)',
  schemaVersion: 'mnet-profile@0.2.0',
  status: 'available',
  rules: { residency: 'cn-only', relay: 'wstunnel' },
  capabilities: {
    realWstunnelRelay: false,
    realTcpInterconnect: false,
    realUdpPathSwitching: false,
    controlPlaneOnly: false,
    realWireGuardTunnel: true,
    realRelayFallback: true
  },
  runtimeConfig: productionRuntimeConfig
} as const

export const mnetEventContracts: EventContract[] = [
  {
    subject: 'mnet.network.created.v0',
    schema: Contracts.MNetNetworkCreatedPayloadSchema,
    fixture: { networkId: 'net-1', name: 'primary', profileVersion: 'm-net-default@0.1.0' }
  },
  {
    subject: 'mnet.membership.joined.v0',
    schema: Contracts.MNetMembershipJoinedPayloadSchema,
    fixture: { networkId: 'net-1', nodeId: 'node-1', nodeKind: 'stem', membershipMode: 'full' }
  },
  {
    subject: 'mnet.profile.enable.requested.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      actor: 'admin',
      policyDecisionId: 'pd-1',
      approvalId: 'approval-1',
      operationId: 'op-1',
      correlationId: 'corr-1',
      reason: 'enable cn',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.enabled.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      actor: 'system',
      policyDecisionId: 'pd-1',
      operationId: 'op-1',
      correlationId: 'corr-1',
      reason: 'approved resume',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.disable.requested.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-cn@0.1.0',
      toProfileVersion: 'm-net-default@0.1.0',
      actor: 'admin',
      policyDecisionId: 'pd-2',
      correlationId: 'corr-2',
      reason: 'disable cn',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.disabled.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-cn@0.1.0',
      toProfileVersion: 'm-net-default@0.1.0',
      actor: 'admin',
      policyDecisionId: 'pd-2',
      correlationId: 'corr-2',
      reason: 'disable cn',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.apply_failed.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      actor: 'system',
      policyDecisionId: 'pd-3',
      operationId: 'op-2',
      correlationId: 'corr-3',
      reason: 'stale_state',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.enable.canceled.v0',
    schema: Contracts.MNetProfileEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      actor: 'system',
      policyDecisionId: 'pd-4',
      operationId: 'op-3',
      correlationId: 'corr-4',
      reason: 'approval rejected',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.profile.defaults.updated.v0',
    schema: Contracts.MNetProfileDefaultsUpdatedEventPayloadSchema,
    fixture: {
      defaultProfileVersion: 'm-net-cn@0.1.0',
      actor: 'admin',
      reason: 'switch all new networks to CN profile',
      correlationId: 'corr-defaults-1',
      controlPlaneOnly: true
    }
  },
  {
    subject: 'mnet.reachability.changed.v0',
    schema: Contracts.MNetReachabilityChangedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      reachable: true,
      latencyMs: 42,
      checkedAt: '2026-06-04T10:00:00.000Z',
      correlationId: 'corr-reachability-1'
    }
  },
  {
    subject: 'mnet.path.changed.v0',
    schema: Contracts.MNetPathChangedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      pathType: 'relay',
      previousPathType: 'direct',
      relayEndpoint: 'wss://relay.cn.example/mnet',
      correlationId: 'corr-path-1'
    }
  },
  {
    subject: 'mnet.wstunnel.fallback.changed.v0',
    schema: Contracts.MNetWstunnelFallbackChangedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      fallbackActive: true,
      reason: 'primary path degraded',
      correlationId: 'corr-fallback-1'
    }
  },
  {
    subject: 'mnet.network_map.published.v0',
    schema: Contracts.MNetNetworkMapPublishedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      mapVersion: 'map-20260604-1',
      members: dataPlaneMembers,
      relayAssignment: networkMapRelayAssignment,
      aclRules: dataPlaneAclRules,
      expiresAt: '2026-06-04T10:05:00.000Z',
      signedBy: 'm-net-cn-control',
      correlationId: 'corr-map-1'
    }
  },
  {
    subject: 'mnet.node_key.rotated.v0',
    schema: Contracts.MNetNodeKeyRotatedEventPayloadSchema,
    fixture: {
      nodeId: 'node-1',
      oldKeyFingerprint: 'wg-fp-old-node-1',
      newKeyFingerprint: 'wg-fp-new-node-1',
      rotationReason: 'scheduled rotation',
      actor: 'security-admin',
      correlationId: 'corr-key-1',
      auditId: 'audit-key-1'
    }
  },
  {
    subject: 'mnet.relay.assigned.v0',
    schema: Contracts.MNetRelayAssignedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      relayEndpoint: 'wss://relay.cn.example/mnet',
      relayType: 'wstunnel',
      correlationId: 'corr-relay-1'
    }
  },
  {
    subject: 'mnet.dataplane.tunnel.changed.v0',
    schema: Contracts.MNetDataplaneTunnelChangedEventPayloadSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      tunnelStatus: 'up',
      previousStatus: 'degraded',
      reason: 'wireguard handshake restored',
      correlationId: 'corr-tunnel-1'
    }
  }
]

export const mnetResponseContracts: ResponseContract[] = [
  {
    route: 'POST /api/v0/networks',
    schema: Contracts.CreateNetworkResponseSchema,
    fixture: {
      network: {
        id: 'net-1',
        name: 'primary',
        profileVersion: 'm-net-default@0.1.0',
        status: 'active',
        createdAt: '2026-06-04T10:00:00.000Z'
      },
      policyDecisionId: 'pd-6',
      correlationId: 'corr-6'
    }
  },
  {
    route: 'GET /api/v0/networks',
    schema: Contracts.NetworkListResponseSchema,
    fixture: {
      networks: [
        {
          id: 'net-1',
          name: 'primary',
          profileVersion: 'm-net-default@0.1.0',
          status: 'active',
          createdAt: '2026-06-04T10:00:00.000Z',
          memberCount: 2
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/networks/:id/members',
    schema: Contracts.JoinNetworkResponseSchema,
    fixture: {
      member: {
        networkId: 'net-1',
        nodeId: 'node-1',
        nodeKind: 'leaf',
        membershipMode: 'restricted',
        status: 'joined',
        joinedAt: '2026-06-04T10:00:00.000Z'
      },
      policyDecisionId: 'pd-7',
      correlationId: 'corr-7'
    }
  },
  {
    route: 'GET /api/v0/networks/:id/members',
    schema: Contracts.NetworkMembersResponseSchema,
    fixture: {
      members: [
        {
          networkId: 'net-1',
          nodeId: 'node-1',
          nodeKind: 'leaf',
          membershipMode: 'restricted',
          status: 'joined',
          joinedAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/network-profiles',
    schema: Contracts.MNetProfileListResponseSchema,
    fixture: {
      profiles: [
        {
          profileVersion: 'm-net-cn@0.1.0',
          region: 'cn',
          displayName: 'M-Net CN',
          schemaVersion: 'mnet-profile@0.1.0',
          status: 'available',
          rules: { residency: 'cn-only' },
          capabilities: {
            realWstunnelRelay: false,
            realTcpInterconnect: false,
            realUdpPathSwitching: false,
            controlPlaneOnly: true
          }
        },
        productionCnProfile
      ]
    }
  },
  {
    route: 'GET /api/v0/network-profiles/:profileVersion',
    schema: Contracts.MNetRegionalProfileSchema,
    fixture: {
      profileVersion: 'm-net-default@0.1.0',
      region: 'default',
      displayName: 'Default',
      schemaVersion: 'mnet-profile@0.1.0',
      status: 'available',
      rules: { residency: 'global' },
      capabilities: {
        realWstunnelRelay: false,
        realTcpInterconnect: false,
        realUdpPathSwitching: false,
        controlPlaneOnly: true
      }
    }
  },
  {
    route: 'POST /api/v0/networks/:id/profile',
    schema: Contracts.SetNetworkProfileResponseSchema,
    fixture: {
      status: 'pending_approval',
      operationId: 'op-1',
      approvalId: 'approval-1',
      correlationId: 'corr-11'
    }
  },
  {
    route: 'POST /api/v0/networks/:id/profile',
    schema: Contracts.SetNetworkProfileResponseSchema,
    fixture: {
      status: 'activated',
      profileVersion: 'm-net-cn@0.2.0',
      operationId: 'op-dataplane-1',
      networkMap: { networkId: 'net-1', mapVersion: 'map-20260604-1' },
      dataPlaneActivationStatus: 'active',
      correlationId: 'corr-dataplane-1'
    }
  },
  {
    route: 'GET /api/v0/networks/:id/network-map',
    schema: Contracts.NetworkMapResponseSchema,
    fixture: {
      networkId: 'net-1',
      mapVersion: 'map-20260604-1',
      members: dataPlaneMembers,
      relayAssignment: networkMapRelayAssignment,
      aclRules: dataPlaneAclRules,
      expiresAt: '2026-06-04T10:05:00.000Z',
      signedBy: 'm-net-cn-control'
    }
  },
  {
    route: 'POST /api/v0/networks/:id/nodes/:nodeId/key',
    schema: Contracts.NodeKeyRegistrationResponseSchema,
    fixture: {
      nodeId: 'node-1',
      keyFingerprint: 'wg-fp-node-1',
      keyMetadata: {
        algorithm: 'wireguard-x25519',
        issuedAt: '2026-06-04T10:00:00.000Z',
        rotationCounter: 1,
        publicKeyFingerprint: 'wg-fp-node-1'
      },
      expiresAt: '2026-06-05T10:00:00.000Z'
    }
  },
  {
    route: 'GET /api/v0/networks/:id/dataplane/status',
    schema: Contracts.DataPlaneStatusResponseSchema,
    fixture: {
      networkId: 'net-1',
      nodeId: 'node-1',
      tunnelStatus: 'up',
      relayAssignment: nodeRelayAssignment,
      lastMapVersion: 'map-20260604-1',
      lastMapAt: '2026-06-04T10:00:00.000Z',
      partitionState: 'connected'
    }
  },
  {
    route: 'POST /internal/v0/network-profile-operations/:id/resume',
    schema: Contracts.InternalNetworkProfileResumeResponseSchema,
    fixture: { status: 'resumed', operationId: 'op-1' }
  },
  {
    route: 'POST /internal/v0/network-profile-operations/:id/reject',
    schema: Contracts.InternalNetworkProfileRejectResponseSchema,
    fixture: { status: 'rejected', operationId: 'op-2' }
  }
]
