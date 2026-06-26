import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import NodeMap from '../../src/lib/components/modules/control-room/NodeMap.svelte'
import DataplaneStatusPanel from '../../src/lib/components/modules/network/DataplaneStatusPanel.svelte'
import NetworkDetailPanel from '../../src/lib/components/modules/network/NetworkDetailPanel.svelte'
import type {
  BffNetworkMapSummary,
  DataPlaneStatusResponseData,
  NetworkDetailResponseData,
  OverviewData,
  StateSourceMetadata
} from '../../src/lib/types.ts'
import { createOverviewFixture } from './_specs/fixtures'

const stateSource: StateSourceMetadata = {
  sourceType: 'authoritative',
  sourceId: 'fixture-source'
}

function nodeWithStatus(
  id: string,
  name: string,
  status: OverviewData['nodes'][number]['status']
): OverviewData['nodes'][number] {
  return {
    ...createOverviewFixture().nodes[0],
    id,
    name,
    status
  }
}

function networkDetailFixture(): NetworkDetailResponseData {
  return {
    network: {
      id: 'network-1',
      name: 'Network 1',
      profileVersion: 'm-net-cn@0.1.0',
      status: 'active',
      createdAt: '2026-06-20T00:00:00.000Z',
      stateSource
    },
    members: [
      {
        networkId: 'network-1',
        nodeId: 'leaf-disabled',
        nodeKind: 'leaf',
        membershipMode: 'restricted',
        status: 'disabled',
        joinedAt: '2026-06-20T00:00:00.000Z',
        stateSource
      },
      {
        networkId: 'network-1',
        nodeId: 'leaf-isolated',
        nodeKind: 'leaf',
        membershipMode: 'restricted',
        status: 'isolated',
        joinedAt: '2026-06-20T00:00:00.000Z',
        stateSource
      }
    ],
    profileState: {
      profileVersion: 'm-net-cn@0.1.0',
      stateSource
    },
    networkMapSummary: mapSummaryFixture(),
    dataPlaneStatus: dataPlaneStatusFixture(),
    stateSource
  }
}

function dataPlaneStatusFixture(): DataPlaneStatusResponseData {
  return {
    networkId: 'network-1',
    nodes: [
      {
        networkId: 'network-1',
        nodeId: 'leaf-recovering',
        tunnelStatus: 'recovering',
        relayAssignment: {
          relayId: 'relay-1',
          relayType: 'wstunnel',
          relayEndpoint: 'relay.local'
        },
        lastMapVersion: '42',
        lastMapAt: '2026-06-20T00:00:00.000Z',
        partitionState: 'recovering',
        stateSource
      }
    ],
    stateSource
  }
}

function mapSummaryFixture(): BffNetworkMapSummary {
  return {
    networkId: 'network-1',
    mapVersion: '42',
    memberCount: 1,
    aclRuleCount: 0,
    relayAssignment: {
      relayType: 'wstunnel',
      relayEndpoint: 'relay.local',
      nodeIds: ['leaf-recovering']
    },
    expiresAt: '2026-06-20T01:00:00.000Z',
    signedBy: 'm-net',
    stateSource
  }
}

describe('node control status visibility', () => {
  it('renders disabled, isolated, and recovering node states as visible NodeMap text', () => {
    render(NodeMap, {
      props: {
        nodes: [
          nodeWithStatus('leaf-disabled', 'Leaf Disabled', 'disabled'),
          nodeWithStatus('leaf-isolated', 'Leaf Isolated', 'isolated'),
          nodeWithStatus('leaf-recovering', 'Leaf Recovering', 'recovering')
        ],
        selectedNodeId: null,
        onSelect: vi.fn()
      }
    })

    expect(screen.getByTestId('node-status-leaf-disabled').textContent).toBe('disabled')
    expect(screen.getByTestId('node-status-leaf-isolated').textContent).toBe('isolated')
    expect(screen.getByTestId('node-status-leaf-recovering').textContent).toBe('recovering')
  })

  it('surfaces controlled node states in network member and dataplane tables', () => {
    render(NetworkDetailPanel, { props: { networkData: networkDetailFixture() } })
    expect(screen.getByTestId('network-member-status-leaf-disabled').textContent).toBe('disabled')
    expect(screen.getByTestId('network-member-status-leaf-isolated').textContent).toBe('isolated')

    render(DataplaneStatusPanel, {
      props: {
        statusData: dataPlaneStatusFixture(),
        mapSummary: mapSummaryFixture()
      }
    })
    expect(screen.getByTestId('dataplane-tunnel-status-leaf-recovering').textContent).toBe(
      'recovering'
    )
    expect(screen.getByTestId('dataplane-partition-state-leaf-recovering').textContent).toBe(
      'recovering'
    )
  })
})
