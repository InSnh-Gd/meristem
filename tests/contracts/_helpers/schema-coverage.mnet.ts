import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

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
            realDerpRelay: false,
            realTcpInterconnect: false,
            realUdpPathSwitching: false,
            controlPlaneOnly: true
          }
        }
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
        realDerpRelay: false,
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
