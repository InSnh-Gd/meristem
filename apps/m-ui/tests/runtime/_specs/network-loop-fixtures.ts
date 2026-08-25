import type {
  JoinTicketListResponseData,
  NetworkDetailResponseData,
  NetworkRuntimeStateData,
  OperationalStateData,
  StateSourceMetadata
} from '../../../src/lib/types.ts'

type DeepMutable<T> =
  T extends ReadonlyArray<infer U>
    ? Array<DeepMutable<U>>
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T

const NETWORK_ID = 'net-loop-001'

function stateSource(
  sourceType: StateSourceMetadata['sourceType'],
  sourceId: string
): StateSourceMetadata {
  return { sourceType, sourceId }
}

export function createNetworkDetailFixture(): DeepMutable<NetworkDetailResponseData> {
  return {
    network: {
      id: NETWORK_ID,
      name: 'Loop Network',
      profileVersion: 'm-net-cn@0.3.0',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
      memberCount: 2,
      stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}`)
    },
    members: [
      {
        networkId: NETWORK_ID,
        nodeId: 'stem-loop-001',
        nodeKind: 'stem',
        membershipMode: 'operator-managed',
        status: 'active',
        joinedAt: '2026-07-01T00:00:00.000Z',
        stateSource: stateSource(
          'authoritative',
          `mnet:/api/v0/networks/${NETWORK_ID}/members/stem-loop-001`
        )
      },
      {
        networkId: NETWORK_ID,
        nodeId: 'leaf-loop-001',
        nodeKind: 'leaf',
        membershipMode: 'join-ticket',
        status: 'active',
        joinedAt: '2026-07-01T00:00:00.000Z',
        stateSource: stateSource(
          'authoritative',
          `mnet:/api/v0/networks/${NETWORK_ID}/members/leaf-loop-001`
        )
      }
    ],
    profileState: {
      profileVersion: 'm-net-cn@0.3.0',
      stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}/profile-state`)
    },
    networkMapSummary: {
      networkId: NETWORK_ID,
      mapVersion: 'map-001',
      memberCount: 2,
      aclRuleCount: 4,
      relayAssignment: {
        relayType: 'direct',
        relayEndpoint: 'relay.meristem.local:51820',
        nodeIds: ['stem-loop-001', 'leaf-loop-001']
      },
      expiresAt: '2026-07-02T00:00:00.000Z',
      signedBy: 'system',
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/network-map`)
    },
    dataPlaneStatus: {
      networkId: NETWORK_ID,
      nodes: [
        {
          networkId: NETWORK_ID,
          nodeId: 'stem-loop-001',
          tunnelStatus: 'up',
          relayAssignment: {
            relayId: 'relay-001',
            relayType: 'direct',
            relayEndpoint: 'relay.meristem.local:51820'
          },
          lastMapVersion: 'map-001',
          lastMapAt: '2026-07-01T12:00:00.000Z',
          partitionState: 'connected',
          stateSource: stateSource(
            'read-model',
            `mnet:/api/v0/networks/${NETWORK_ID}/dataplane/stem-loop-001`
          )
        },
        {
          networkId: NETWORK_ID,
          nodeId: 'leaf-loop-001',
          tunnelStatus: 'up',
          relayAssignment: {
            relayId: 'relay-001',
            relayType: 'direct',
            relayEndpoint: 'relay.meristem.local:51820'
          },
          lastMapVersion: 'map-001',
          lastMapAt: '2026-07-01T12:00:00.000Z',
          partitionState: 'connected',
          stateSource: stateSource(
            'read-model',
            `mnet:/api/v0/networks/${NETWORK_ID}/dataplane/leaf-loop-001`
          )
        }
      ],
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/dataplane`)
    },
    stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}`)
  }
}

export function createOperationalStateFixture(): DeepMutable<OperationalStateData> {
  return {
    networkId: NETWORK_ID,
    network: {
      status: 'active',
      memberCount: 2,
      profileState: 'enabled',
      lastUpdatedAt: '2026-07-01T12:00:00.000Z',
      summary: 'network is active and reachable'
    },
    profileSelection: {
      profileVersion: 'm-net-cn@0.3.0',
      displayName: 'M-Net CN (v0.3)',
      schemaVersion: 'mnet-profile@0.3.0',
      region: 'cn',
      controlPlaneOnly: false,
      compatibility: 'compatible'
    },
    eventStream: {
      status: 'healthy',
      lastSubject: 'mnet.sidecar.health.v0',
      lastEventId: 'evt-001',
      lastEventAt: '2026-07-01T12:00:00.000Z'
    },
    sidecars: [
      {
        nodeId: 'stem-loop-001',
        nodeKind: 'stem',
        profileVersion: 'm-net-cn@0.3.0',
        credentialStatus: 'ready',
        healthStatus: 'healthy',
        stale: false,
        summary: 'stem sidecar is healthy'
      },
      {
        nodeId: 'leaf-loop-001',
        nodeKind: 'leaf',
        profileVersion: 'm-net-cn@0.3.0',
        credentialStatus: 'ready',
        healthStatus: 'healthy',
        stale: false,
        summary: 'leaf sidecar is healthy'
      }
    ],
    topology: {
      topologyRevision: 'topo-001',
      routeClass: 'standard',
      nodes: [
        {
          nodeId: 'stem-loop-001',
          label: 'Stem',
          nodeKind: 'stem',
          healthStatus: 'healthy',
          state: 'healthy'
        },
        {
          nodeId: 'leaf-loop-001',
          label: 'Leaf',
          nodeKind: 'leaf',
          healthStatus: 'healthy',
          state: 'healthy'
        }
      ],
      edges: [
        {
          edgeId: 'edge-001',
          fromNodeId: 'stem-loop-001',
          toNodeId: 'leaf-loop-001',
          relation: 'peer'
        }
      ],
      summary: 'topology is connected'
    },
    credentials: {
      status: 'healthy',
      nodes: [
        {
          nodeId: 'stem-loop-001',
          credentialStatus: 'ready',
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/sidecar',
            version: 1
          },
          expiresAt: '2026-08-01T00:00:00.000Z',
          summary: 'stem credential is ready'
        },
        {
          nodeId: 'leaf-loop-001',
          credentialStatus: 'ready',
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/sidecar',
            version: 1
          },
          expiresAt: '2026-08-01T00:00:00.000Z',
          summary: 'leaf credential is ready'
        }
      ],
      summary: 'all credentials are ready'
    },
    migrationRequired: {
      required: false,
      summary: 'no migration required'
    },
    forcedRelay: {
      active: false,
      affectedNodeIds: [],
      summary: 'forced relay is not active'
    },
    deploymentReadiness: {
      status: 'healthy',
      summary: 'deployment is ready',
      reasons: []
    },
    stateSources: {
      network: 'authoritative',
      profileSelection: 'authoritative',
      sidecars: 'read-model',
      topology: 'read-model',
      credentials: 'read-model',
      migration: 'read-model',
      forcedRelay: 'read-model',
      deploymentReadiness: 'composed',
      eventStream: 'read-model'
    },
    stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/operational-state`)
  }
}

export function createProofPathFixture(): DeepMutable<NetworkRuntimeStateData> {
  return {
    networkId: NETWORK_ID,
    createManageStatus: {
      mode: 'manage',
      networkId: NETWORK_ID,
      networkStatus: 'active',
      profileState: 'enabled',
      memberCount: 2,
      lastUpdatedAt: '2026-07-01T12:00:00.000Z',
      summary: 'network is managed and active',
      stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}`)
    },
    profileSelection: {
      networkId: NETWORK_ID,
      profileSelection: {
        profileVersion: 'm-net-cn@0.3.0',
        displayName: 'M-Net CN (v0.3)',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'cn',
        controlPlaneOnly: false,
        compatibility: 'compatible'
      },
      summary: 'profile is compatible',
      stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}/profile`)
    },
    topology: {
      networkId: NETWORK_ID,
      topology: {
        topologyRevision: 'topo-001',
        routeClass: 'standard',
        nodes: [
          {
            nodeId: 'stem-loop-001',
            label: 'Stem',
            nodeKind: 'stem',
            healthStatus: 'healthy',
            state: 'healthy'
          },
          {
            nodeId: 'leaf-loop-001',
            label: 'Leaf',
            nodeKind: 'leaf',
            healthStatus: 'healthy',
            state: 'healthy'
          }
        ],
        edges: [
          {
            edgeId: 'edge-001',
            fromNodeId: 'stem-loop-001',
            toNodeId: 'leaf-loop-001',
            relation: 'peer'
          }
        ],
        summary: 'topology is connected'
      },
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/topology`)
    },
    sidecarHealth: {
      networkId: NETWORK_ID,
      status: 'healthy',
      summary: 'all sidecars are healthy',
      nodes: [
        {
          nodeId: 'stem-loop-001',
          nodeKind: 'stem',
          profileVersion: 'm-net-cn@0.3.0',
          credentialStatus: 'ready',
          healthStatus: 'healthy',
          stale: false,
          summary: 'stem sidecar is healthy'
        },
        {
          nodeId: 'leaf-loop-001',
          nodeKind: 'leaf',
          profileVersion: 'm-net-cn@0.3.0',
          credentialStatus: 'ready',
          healthStatus: 'healthy',
          stale: false,
          summary: 'leaf sidecar is healthy'
        }
      ],
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/sidecars`)
    },
    credentialLifecycle: {
      networkId: NETWORK_ID,
      credentials: {
        status: 'healthy',
        nodes: [
          {
            nodeId: 'stem-loop-001',
            credentialStatus: 'ready',
            credentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/sidecar',
              version: 1
            },
            expiresAt: '2026-08-01T00:00:00.000Z',
            summary: 'stem credential is ready'
          },
          {
            nodeId: 'leaf-loop-001',
            credentialStatus: 'ready',
            credentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/sidecar',
              version: 1
            },
            expiresAt: '2026-08-01T00:00:00.000Z',
            summary: 'leaf credential is ready'
          }
        ],
        summary: 'all credentials are ready'
      },
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/credentials`)
    },
    migration: {
      networkId: NETWORK_ID,
      migration: {
        required: false,
        summary: 'no migration required'
      },
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/migration`)
    },
    policyEligibility: {
      networkId: NETWORK_ID,
      commands: [
        {
          commandId: 'network.profile.enable.execute',
          label: '启用 Profile',
          action: 'network:profile-enable',
          resource: `network:${NETWORK_ID}`,
          requiredPermissions: ['network:profile-enable'],
          requiresPolicy: true,
          requiresAudit: true,
          state: 'enabled',
          summary: 'profile enable is eligible',
          targetNodeKind: 'stem'
        }
      ],
      stateSource: stateSource('policy', `m-policy:/internal/v0/authorize#network:${NETWORK_ID}`)
    },
    progressFeed: {
      networkId: NETWORK_ID,
      eventStream: {
        status: 'healthy',
        lastSubject: 'mnet.sidecar.health.v0',
        lastEventId: 'evt-001',
        lastEventAt: '2026-07-01T12:00:00.000Z'
      },
      deploymentReadiness: {
        status: 'healthy',
        summary: 'deployment is ready',
        reasons: []
      },
      summary: 'progress is healthy',
      stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/progress`)
    },
    runtimeTruth: {
      auth: {
        mode: 'local-dev',
        summary: 'local-dev auth is active',
        stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}/auth`)
      },
      secretProvider: {
        status: 'resolved',
        summary: 'secret provider resolved',
        stateSource: stateSource('authoritative', `mnet:/api/v0/networks/${NETWORK_ID}/secrets`)
      },
      netbirdProcess: {
        desired: 'running',
        observed: 'running',
        status: 'healthy',
        summary: 'NetBird process is running and healthy',
        nodes: [
          {
            nodeId: 'stem-loop-001',
            desired: 'running',
            observed: 'running',
            status: 'healthy',
            detail: 'NetBird is running on stem'
          },
          {
            nodeId: 'leaf-loop-001',
            desired: 'running',
            observed: 'running',
            status: 'healthy',
            detail: 'NetBird is running on leaf'
          }
        ],
        stateSource: stateSource(
          'read-model',
          `mnet:/api/v0/networks/${NETWORK_ID}/netbird-process`
        )
      },
      packetProof: {
        status: 'success',
        summary: 'packet reachability proof succeeded',
        source: 'stem-loop-001',
        target: 'leaf-loop-001',
        probe: 'tcp',
        targetOverlayIp: '100.64.0.2',
        stateSource: stateSource('read-model', `mnet:/api/v0/networks/${NETWORK_ID}/packet-proof`)
      },
      profile: {
        state: 'enabled',
        reason: 'Profile 已成功启用',
        stateSource: stateSource(
          'read-model',
          `mnet:/api/v0/networks/${NETWORK_ID}/operational-state#network`
        )
      },
      repairActions: [
        {
          commandId: 'network.forced-relay.change.execute',
          state: 'enabled',
          stateSource: stateSource(
            'policy',
            `m-policy:/internal/v0/authorize#network:${NETWORK_ID}`
          )
        }
      ]
    }
  }
}

export function createJoinTicketsFixture(): DeepMutable<JoinTicketListResponseData> {
  return {
    tickets: [
      {
        ticketId: 'ticket-001',
        ticket: 'jtb64fixture',
        expiresAt: '2026-07-02T12:00:00.000Z',
        joinUrl: `http://localhost:3200/api/v0/networks/${NETWORK_ID}/join/ticket-001`,
        policyDecisionId: 'pd-001',
        correlationId: 'corr-001',
        networkId: NETWORK_ID,
        status: 'active'
      }
    ]
  }
}
