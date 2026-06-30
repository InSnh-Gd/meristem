import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import {
  captureOriginalFetch,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest,
  restoreOriginalFetch
} from './_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

function createMockMNetApp() {
  return new Elysia()
    .get('/api/v0/networks/network-cn-001/join-tickets', () => ({
      tickets: [
        {
          ticketId: 'jt-1',
          ticket: 'ticket-1',
          expiresAt: '2026-06-18T10:00:00.000Z',
          joinUrl: 'https://join.example/jt-1',
          policyDecisionId: 'policy-jt-1',
          correlationId: 'corr-jt-1',
          networkId: 'network-cn-001',
          status: 'active'
        }
      ]
    }))
    .post('/api/v0/networks/network-join/join-tickets', ({ body }) => ({
      ticketId: 'jt-created',
      ticket: 'ticket-created',
      expiresAt: '2026-06-18T10:00:00.000Z',
      joinUrl: 'https://join.example/jt-created',
      policyDecisionId: 'policy-jt-created',
      correlationId: 'corr-jt-created',
      networkId: 'network-cn-001',
      status: 'active',
      received: body
    }))
    .get('/api/v0/networks/network-cn-001/dataplane/status', () => ({
      networkId: 'network-cn-001',
      nodes: [
        {
          networkId: 'network-cn-001',
          nodeId: 'leaf-1',
          tunnelStatus: 'healthy',
          relayAssignment: {
            relayId: 'relay-1',
            relayType: 'managed',
            relayEndpoint: 'relay.example:443'
          },
          lastMapVersion: 'map-v1',
          lastMapAt: '2026-06-18T09:30:00.000Z',
          partitionState: 'connected',
          stateSource: {
            sourceType: 'authoritative',
            sourceId: 'mnet:/status/network-cn-001/leaf-1'
          }
        }
      ],
      stateSource: { sourceType: 'authoritative', sourceId: 'mnet:/status/network-cn-001' }
    }))
    .get('/api/v0/networks/network-cn-001/operational-state', () => ({
      networkId: 'network-cn-001',
      network: {
        status: 'degraded',
        memberCount: 1,
        profileState: 'enabled',
        lastUpdatedAt: '2026-06-18T09:30:00.000Z',
        summary: '1 node tracked in the operational read model'
      },
      profileSelection: {
        profileVersion: 'm-net-cn@0.3.0',
        displayName: 'M-Net CN v0.3',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'cn',
        controlPlaneOnly: false,
        compatibility: 'migration_required',
        migration: {
          code: 'migration_required',
          message: 'legacy node must rebuild to NetBird sidecar',
          targetProfileVersion: 'm-net-cn@0.3.0',
          rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
          affectedProfileIds: ['m-net-cn@0.2.0'],
          affectedNodeIds: ['leaf-1'],
          reasonCode: 'legacy_wstunnel_node'
        }
      },
      eventStream: {
        status: 'healthy',
        lastSubject: 'mnet.sidecar.health.v0',
        lastEventId: 'evt-1',
        lastEventAt: '2026-06-18T09:30:00.000Z'
      },
      sidecars: [
        {
          nodeId: 'leaf-1',
          nodeKind: 'leaf',
          profileVersion: 'm-net-cn@0.3.0',
          credentialStatus: 'expired',
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/leaf-1'
          },
          expiresAt: '2026-06-18T08:00:00.000Z',
          healthStatus: 'healthy',
          checkedAt: '2026-06-18T09:30:00.000Z',
          signalReachable: true,
          relayReachable: true,
          stunReachable: false,
          stale: false,
          summary: 'Credential has expired'
        }
      ],
      topology: {
        topologyRevision: 'map-v1',
        routeClass: 'forced-tcp-relay',
        nodes: [
          {
            nodeId: 'leaf-1',
            label: 'leaf:leaf-1',
            nodeKind: 'leaf',
            healthStatus: 'healthy',
            state: 'migration_required'
          }
        ],
        edges: [
          {
            edgeId: 'leaf-1->relay-1:forced',
            fromNodeId: 'leaf-1',
            toNodeId: 'relay-1',
            relation: 'forced-relay'
          }
        ],
        summary: '1 nodes and 1 edges are visible'
      },
      credentials: {
        status: 'blocked',
        nodes: [
          {
            nodeId: 'leaf-1',
            credentialStatus: 'expired',
            expiresAt: '2026-06-18T08:00:00.000Z',
            credentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/leaf-1'
            },
            summary: 'Credential has expired'
          }
        ],
        summary: 'Credential lifecycle is derived from the latest sidecar events'
      },
      migrationRequired: {
        required: true,
        resourceKind: 'node',
        migration: {
          code: 'migration_required',
          message: 'legacy node must rebuild to NetBird sidecar',
          targetProfileVersion: 'm-net-cn@0.3.0',
          rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
          affectedProfileIds: ['m-net-cn@0.2.0'],
          affectedNodeIds: ['leaf-1'],
          reasonCode: 'legacy_wstunnel_node'
        },
        summary: 'legacy node must rebuild to NetBird sidecar'
      },
      forcedRelay: {
        active: true,
        routeClass: 'forced-tcp-relay',
        selectorOwnership: 'policy',
        selector: {
          selectorType: 'node-ids',
          nodeIds: ['leaf-1']
        },
        operatorOverrideActive: false,
        affectedNodeIds: ['leaf-1'],
        summary: '1 nodes are pinned to forced relay'
      },
      deploymentReadiness: {
        status: 'blocked',
        summary: '2 readiness issue(s)',
        reasons: [
          {
            code: 'migration_required',
            message: 'legacy node must rebuild to NetBird sidecar',
            nodeId: 'leaf-1'
          },
          {
            code: 'credential_expired',
            message: 'credential expired for leaf-1',
            nodeId: 'leaf-1'
          }
        ]
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
      }
    }))
    .get('/api/v0/networks/profile-defaults', () => ({
      defaultProfileVersion: 'm-net@0.3.0',
      globalSwitchState: 'idle',
      updatedAt: '2026-06-18T09:00:00.000Z'
    }))
}

describe('M-UI BFF M-Net dataplane contracts', () => {
  it('keeps viewer eligibility disabled with visible reason', async () => {
    const viewerApp = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' })),
      mnetApp: createMockMNetApp()
    })
    const eligibilityRes = await makeRequest(
      viewerApp,
      '/api/v0/commands/network.join-ticket.create.execute/eligibility',
      'POST',
      'viewer-token',
      { networkId: 'network-cn-001' }
    )
    expect(eligibilityRes.status).toBe(200)
    expect(await eligibilityRes.json()).toMatchObject({
      state: 'disabled',
      disabledReason: '缺少权限：node:register'
    })
  })

  it('break-glass requires confirmation body and returns validation error without upstream call', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
      mnetApp: createMockMNetApp()
    })

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.break-glass.execute/execute',
      'POST',
      'security-admin-token',
      { networkId: 'network-cn-001' }
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'command.invalid_body' } })
  })

  it('disabled command creates no audit fact because no upstream mutation is sent', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createBffWithServices({
      coreApp: createCoreApp(deps),
      mnetApp: createMockMNetApp()
    })

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    try {
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.join-ticket.create.execute/eligibility',
        'POST',
        'viewer-token',
        { networkId: 'network-cn-001' }
      )
      expect(res.status).toBe(200)
      expect(requests.every(request => request.method === 'GET')).toBe(true)
      const audit = await deps.log.listAudit()
      expect(audit.ok ? audit.value.length : -1).toBe(0)
    } finally {
      globalThis.fetch = delegatedFetch
    }
  })

  it('adapts public operational facts into proof-path payload and typed disabled reasons', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })),
      mnetApp: createMockMNetApp()
    })

    const res = await makeRequest(app, '/api/v0/networks/network-cn-001/proof-path', 'GET', 'admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      networkId: string
      profileSelection: { disabledReason?: { code: string; message: string } }
      migration: { disabledReason?: { code: string; migration?: { targetProfileVersion: string } } }
      credentialLifecycle: {
        credentials: {
          nodes: Array<{ credentialRef?: Record<string, unknown> }>
        }
      }
    }
    const credentialNode = body.credentialLifecycle.credentials.nodes[0]
    expect(credentialNode).toBeDefined()
    expect(body.networkId).toBe('network-cn-001')
    expect(body.profileSelection.disabledReason).toMatchObject({
      code: 'migration_required',
      message: 'legacy node must rebuild to NetBird sidecar'
    })
    expect(body.migration.disabledReason).toMatchObject({
      code: 'migration_required',
      migration: {
        targetProfileVersion: 'm-net-cn@0.3.0'
      }
    })
    expect(credentialNode?.credentialRef?.token).toBeUndefined()
    expect(credentialNode?.credentialRef?.raw).toBeUndefined()
  })

  it('does not expose raw node credential tokens through execute path', async () => {
    const app = createBffWithServices({
      coreApp: new Elysia()
        .get('/api/v0/session', () => ({ actor: 'operator', permissions: ['node:issue-token'] }))
        .post('/api/v0/networks/network-cn-001/nodes/leaf-1/credentials', () => ({
          nodeId: 'leaf-1',
          token: 'secret-token',
          issuedAt: '2026-06-18T09:00:00.000Z',
          policyDecisionId: 'policy-1',
          correlationId: 'corr-1'
        })),
      mnetApp: createMockMNetApp()
    })

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.node-credential.issue.execute/execute',
      'POST',
      'operator-token',
      { networkId: 'network-cn-001', nodeId: 'leaf-1' }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      nodeId: string
      action: string
      policyDecisionId: string
      token?: string
    }
    expect(body).toMatchObject({
      nodeId: 'leaf-1',
      action: 'issued',
      policyDecisionId: 'policy-1'
    })
    expect(body.token).toBeUndefined()
  })

  it('OpenAPI declares stateSource metadata for proof-path routes', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })),
      mnetApp: createMockMNetApp()
    })
    const res = await makeRequest(app, '/openapi', 'GET')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      paths: Record<string, Record<string, { description?: string; [key: string]: unknown }>>
    }
    const requiredPaths = [
      '/api/v0/networks/{id}',
      '/api/v0/networks/{id}/dataplane/status',
      '/api/v0/networks/{id}/dataplane/relay',
      '/api/v0/networks/{id}/dataplane/network-map',
      '/api/v0/networks/{id}/proof-path'
    ]
    for (const path of requiredPaths) {
      const operation = Object.values(body.paths[path] ?? {})[0] as { description?: string } | undefined
      expect(operation?.description?.includes('stateSources:')).toBe(true)
    }
  })
})
