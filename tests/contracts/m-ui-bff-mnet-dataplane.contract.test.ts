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

/** 为 M-Net 数据面面板测试提供最小 mock facade。 */
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
    .get('/internal/v0/networks/network-cn-001/members', () => ({
      members: [
        {
          networkId: 'network-cn-001',
          nodeId: 'leaf-1',
          nodeKind: 'leaf',
          membershipMode: 'full',
          status: 'joined',
          joinedAt: '2026-06-18T09:00:00.000Z'
        }
      ]
    }))
    .get('/internal/v0/networks/network-cn-001/network-map', () => ({
      networkId: 'network-cn-001',
      mapVersion: 'map-v1',
      members: [{ nodeId: 'leaf-1', tunnelIp: '10.1.0.2/32', publicKeyFingerprint: 'pub-1' }],
      aclRules: [
        {
          ruleId: 'acl-1',
          action: 'allow',
          sourceNodeId: 'leaf-1',
          targetNodeId: 'leaf-1',
          protocol: 'tcp'
        }
      ],
      relayAssignment: {
        relayType: 'managed',
        relayEndpoint: 'relay.example:443',
        nodeIds: ['leaf-1']
      },
      expiresAt: '2026-06-18T11:00:00.000Z',
      signedBy: 'sig-key-1'
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
    .get('/api/v0/networks/profile-defaults', () => ({
      defaultProfileVersion: 'm-net-default@0.1.0',
      globalSwitchState: 'idle',
      updatedAt: '2026-06-18T09:00:00.000Z'
    }))
}

describe('M-UI BFF M-Net dataplane contracts', () => {
  it('operator can create join ticket and viewer eligibility is disabled with visible reason', async () => {
    const coreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const app = createBffWithServices({ coreApp, mnetApp: createMockMNetApp() })

    const createRes = await makeRequest(
      app,
      '/api/v0/networks/network-cn-001/join-tickets',
      'POST',
      'operator-token',
      {
        kind: 'leaf',
        name: 'leaf-cn-join'
      }
    )
    expect(createRes.status).toBe(200)
    const createBody = (await createRes.json()) as { ticketId: string; networkId: string }
    expect(createBody.ticketId).toBe('jt-created')
    expect(createBody.networkId).toBe('network-cn-001')

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

  it('OpenAPI declares stateSource metadata for every new route', async () => {
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
      '/api/v0/networks/{id}/join-tickets',
      '/api/v0/networks/{id}/dataplane/status',
      '/api/v0/networks/{id}/dataplane/relay',
      '/api/v0/networks/{id}/dataplane/network-map',
      '/api/v0/networks/defaults',
      '/api/v0/networks/migration/dry-run',
      '/api/v0/networks/migration/apply',
      '/api/v0/networks/migration/resume',
      '/api/v0/networks/migration/rollback'
    ]
    for (const path of requiredPaths) {
      const operation = Object.values(body.paths[path] ?? {})[0] as
        | { description?: string }
        | undefined
      expect(operation?.description?.includes('stateSources:')).toBe(true)
    }
  })
})
