import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import { createEventBusApp } from '../../services/m-eventbus/src/app.ts'
import {
  CORE_BASE,
  captureOriginalFetch,
  createBffWithCore,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  createInMemoryMTaskDeps,
  createMTaskApp,
  makeRequest,
  restoreOriginalFetch
} from './_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

function createPolicySummaryApp() {
  return new Elysia().get('/internal/v0/summary', () => ({
    generatedAt: '2026-06-18T00:00:00.000Z',
    decisions: {
      total: 4,
      allow: 1,
      deny: 1,
      requireManualReview: 1,
      requireMultiApproval: 1,
      latestCreatedAt: '2026-06-18T00:00:00.000Z'
    },
    recentDecisions: [
      {
        id: 'decision-1',
        actor: 'admin',
        action: 'task:submit',
        resource: 'task:123',
        result: 'require_multi_approval',
        createdAt: '2026-06-18T00:00:00.000Z'
      }
    ],
    approvals: {
      total: 3,
      pending: 1,
      approved: 1,
      rejected: 1,
      expired: 0,
      canceled: 0,
      latestCreatedAt: '2026-06-18T00:00:00.000Z',
      nextExpiryAt: '2026-06-18T01:00:00.000Z'
    },
    pendingApprovals: [
      {
        approvalId: 'approval-1',
        policyDecisionId: 'decision-1',
        requestedBy: 'admin',
        requiredAction: 'multi_approval',
        status: 'pending',
        createdAt: '2026-06-18T00:00:00.000Z',
        expiresAt: '2026-06-18T01:00:00.000Z'
      }
    ]
  }))
}

describe('SDUI v0.2 BFF routes', () => {
  it('GET /api/v0/routes returns route registry', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { routes: Array<{ id: string }> }
    expect(Array.isArray(body.routes)).toBe(true)
    expect(body.routes).toHaveLength(17)
    expect(body.routes.map(route => route.id)).toEqual([
      'control-room.overview',
      'nodes.index',
      'nodes.detail',
      'timeline.index',
      'audit.index',
      'policy.decisions',
      'policy.approvals',
      'policy.approvals.detail',
      'network.profiles',
      'network.profiles.detail',
      'services.index',
      'networks.index',
      'networks.detail',
      'nodes.credentials',
      'mnet.dataplane.status',
      'mnet.profile.migration',
      'mnet.break-glass'
    ])
  })

  it('GET /api/v0/routes/:id returns one route', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/routes/control-room.overview',
      'GET',
      'operator-token'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { route: { id: string } }
    expect(body.route.id).toBe('control-room.overview')
  })

  it('GET /api/v0/routes/:id unknown route returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes/nonexistent', 'GET', 'operator-token')
    expect(res.status).toBe(404)
  })

  it('GET /api/v0/nodes returns node list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/nodes', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nodes: Array<{ id: string }> }
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  it('GET /api/v0/timeline returns timeline entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/timeline', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: Array<{ id: string }> }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('GET /api/v0/audit returns audit entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/audit', 'GET', 'security-admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: Array<{ id: string }> }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('GET /api/v0/audit denies operator', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/audit', 'GET', 'operator-token')
    expect(res.status).toBe(403)
  })

  it('GET /api/v0/policy/decisions returns decision list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/policy/decisions', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decisions: Array<{ id: string }> }
    expect(Array.isArray(body.decisions)).toBe(true)
  })

  it('GET /api/v0/policy/decisions/:id returns decision with stateSource', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const taskApp = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-policy-detail', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id
    const execRes = await coreApp.handle(
      new Request(`http://localhost/api/v0/nodes/${leafId}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const execBody = (await execRes.json()) as { policyDecisionId: string }
    expect(execBody.policyDecisionId).toBeDefined()

    const app = createBffWithCore(coreApp, taskApp)
    const res = await makeRequest(
      app,
      `/api/v0/policy/decisions/${execBody.policyDecisionId}`,
      'GET',
      'operator-token'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(body.id).toBe(execBody.policyDecisionId)
    expect(body.stateSource).toBeDefined()
    expect(body.stateSource.sourceType).toBe('policy')
  })

  it('GET /api/v0/policy/approvals returns approval queue with stateSource metadata', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/policy/approvals', 'GET', 'admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      approvals: Array<{ id: string; stateSource: { sourceType: string; sourceId: string } }>
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(Array.isArray(body.approvals)).toBe(true)
    expect(body.approvals[0]?.stateSource.sourceType).toBe('policy')
    expect(body.stateSource).toEqual({
      sourceType: 'policy',
      sourceId: 'core:/api/v0/policy/approvals'
    })
  })

  it('GET /api/v0/policy/approvals returns empty queue as 200', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin', approvals: [] })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/policy/approvals', 'GET', 'admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      approvals: unknown[]
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(body.approvals).toEqual([])
    expect(body.stateSource.sourceId).toBe('core:/api/v0/policy/approvals')
  })

  it('GET /api/v0/policy/approvals/:id returns approval detail with stateSource', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/policy/approvals/approval-core-facade-1',
      'GET',
      'admin-token'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      votes: unknown[]
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(body.id).toBe('approval-core-facade-1')
    expect(Array.isArray(body.votes)).toBe(true)
    expect(body.stateSource).toEqual({
      sourceType: 'policy',
      sourceId: 'core:/api/v0/policy/approvals/approval-core-facade-1'
    })
  })

  it('GET /api/v0/policy/approvals preserves 401, 403, and 503 envelopes', async () => {
    const adminCoreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))
    const operatorCoreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const downCoreApp = createCoreApp(
      createInMemoryCoreDeps({ actor: 'admin', approvalReaderAvailable: false })
    )

    const missingToken = await makeRequest(
      createBffWithCore(adminCoreApp),
      '/api/v0/policy/approvals'
    )
    expect(missingToken.status).toBe(401)
    expect(await missingToken.json()).toMatchObject({ error: { code: 'auth.missing_token' } })

    const denied = await makeRequest(
      createBffWithCore(operatorCoreApp),
      '/api/v0/policy/approvals',
      'GET',
      'operator-token'
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const unavailable = await makeRequest(
      createBffWithCore(downCoreApp),
      '/api/v0/policy/approvals',
      'GET',
      'admin-token'
    )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'm-policy.unavailable' } })
  })

  it('GET /api/v0/policy/approvals/:id preserves 404 envelope', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/policy/approvals/missing-approval',
      'GET',
      'admin-token'
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'approval.not_found' } })
  })

  it('GET /api/v0/network-profiles returns profiles with authoritative stateSource metadata', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      profiles: Array<{
        profileVersion: string
        stateSource: { sourceType: string; sourceId: string }
      }>
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(body.profiles.map(profile => profile.profileVersion).sort()).toEqual([
      'm-net-cn@0.1.0',
      'm-net-default@0.1.0'
    ])
    const cnProfile = body.profiles.find(profile => profile.profileVersion === 'm-net-cn@0.1.0')
    expect(cnProfile?.stateSource.sourceId).toBe('core:/api/v0/network-profiles/m-net-cn@0.1.0')
    expect(body.profiles[0]?.stateSource.sourceType).toBe('authoritative')
    expect(body.stateSource).toEqual({
      sourceType: 'authoritative',
      sourceId: 'core:/api/v0/network-profiles'
    })
  })

  it('GET /api/v0/network-profiles/:profileVersion returns profile detail with authoritative stateSource', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/network-profiles/m-net-cn@0.1.0',
      'GET',
      'admin-token'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      profileVersion: string
      stateSource: { sourceType: string; sourceId: string }
    }
    expect(body.profileVersion).toBe('m-net-cn@0.1.0')
    expect(body.stateSource).toEqual({
      sourceType: 'authoritative',
      sourceId: 'core:/api/v0/network-profiles/m-net-cn@0.1.0'
    })
  })

  it('GET /api/v0/network-profiles preserves 401, 403, and 503 envelopes', async () => {
    const adminCoreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))
    const viewerCoreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' }))
    const downCoreApp = createCoreApp(
      createInMemoryCoreDeps({ actor: 'admin', networkProfileReaderAvailable: false })
    )

    const missingToken = await makeRequest(
      createBffWithCore(adminCoreApp),
      '/api/v0/network-profiles'
    )
    expect(missingToken.status).toBe(401)
    expect(await missingToken.json()).toMatchObject({ error: { code: 'auth.missing_token' } })

    const denied = await makeRequest(
      createBffWithCore(viewerCoreApp),
      '/api/v0/network-profiles',
      'GET',
      'viewer-token'
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const unavailable = await makeRequest(
      createBffWithCore(downCoreApp),
      '/api/v0/network-profiles',
      'GET',
      'admin-token'
    )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'mnet.unavailable' } })
  })

  it('GET /api/v0/network-profiles/:profileVersion preserves 404 envelope', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/network-profiles/unknown-profile@0.1.0',
      'GET',
      'admin-token'
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'profile.not_found' } })
  })

  it('GET /api/v0/services returns service list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/services', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { services: Array<{ id: string }> }
    expect(Array.isArray(body.services)).toBe(true)
  })

  it('GET /api/v0/services/:id returns service inspector with EventBus metrics for m-eventbus', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const eventbusApp = createEventBusApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      publishMetricsSummary() {
        return {
          service: 'm-eventbus' as const,
          generatedAt: '2026-06-18T00:00:00.000Z',
          windowStartedAt: '2026-06-18T00:00:00.000Z',
          totals: { success: 12, rejected: 2, failed: 1, retryAttempts: 4 },
          subjects: []
        }
      },
      async publish(_subject, event) {
        return { eventId: event.id }
      },
      async reportRejected() {
        return
      }
    })
    const app = createBffWithServices({ coreApp, eventbusApp })

    const res = await makeRequest(app, '/api/v0/services/m-eventbus', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      service: { id: string; stateSource: { sourceType: string; sourceId: string } }
      eventBusMetrics: { totals: { success: number; failed: number } } | null
      eventBusMetricsStateSource: { sourceType: string; sourceId: string } | null
      logProjectionHealth: unknown
      policySummary: unknown
    }
    expect(body.service.id).toBe('m-eventbus')
    expect(body.service.stateSource.sourceType).toBe('authoritative')
    expect(body.eventBusMetrics?.totals.success).toBe(12)
    expect(body.eventBusMetrics?.totals.failed).toBe(1)
    expect(body.eventBusMetricsStateSource).toEqual({
      sourceType: 'read-model',
      sourceId: 'm-eventbus:/internal/v0/metrics/publish-summary'
    })
    expect(body.logProjectionHealth).toBeNull()
    expect(body.policySummary).toBeNull()
  })

  it('GET /api/v0/services/:id returns projection health for m-log', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/services/m-log', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      service: { id: string }
      eventBusMetrics: unknown
      eventBusMetricsStateSource: unknown
      logProjectionHealth: { indices: Array<{ index: string; status: string }> } | null
      logProjectionHealthStateSource: { sourceType: string; sourceId: string } | null
      policySummary: unknown
    }
    expect(body.service.id).toBe('m-log')
    expect(body.eventBusMetrics).toBeNull()
    expect(body.eventBusMetricsStateSource).toBeNull()
    expect(Array.isArray(body.logProjectionHealth?.indices)).toBe(true)
    expect(body.logProjectionHealthStateSource).toEqual({
      sourceType: 'read-model',
      sourceId: 'core:/api/v0/projection/health'
    })
    expect(body.policySummary).toBeNull()
  })

  it('GET /api/v0/services/:id returns policy summary for m-policy', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithServices({ coreApp, policyApp: createPolicySummaryApp() })

    const res = await makeRequest(app, '/api/v0/services/m-policy', 'GET', 'admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      service: { id: string }
      eventBusMetrics: unknown
      logProjectionHealth: unknown
      policySummary: {
        approvals: { total: number; pending: number }
        decisions: { total: number }
        recentDecisions: Array<{ id: string }>
        pendingApprovals: Array<{ approvalId: string; status: string }>
      } | null
      policySummaryStateSource: { sourceType: string; sourceId: string } | null
    }
    expect(body.service.id).toBe('m-policy')
    expect(body.eventBusMetrics).toBeNull()
    expect(body.logProjectionHealth).toBeNull()
    expect(body.policySummary?.approvals.total).toBe(3)
    expect(body.policySummary?.approvals.pending).toBe(1)
    expect(body.policySummary?.decisions.total).toBe(4)
    expect(body.policySummary?.recentDecisions[0]?.id).toBe('decision-1')
    expect(Array.isArray(body.policySummary?.pendingApprovals)).toBe(true)
    expect(body.policySummaryStateSource).toEqual({
      sourceType: 'policy',
      sourceId: 'm-policy:/internal/v0/summary'
    })
  })

  it('GET /api/v0/services/:id keeps optional service sections null for unrelated services', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/services/m-net', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      service: { id: string }
      eventBusMetrics: unknown
      eventBusMetricsStateSource: unknown
      logProjectionHealth: unknown
      logProjectionHealthStateSource: unknown
      policySummary: unknown
      policySummaryStateSource: unknown
    }
    expect(body.service.id).toBe('m-net')
    expect(body.eventBusMetrics).toBeNull()
    expect(body.eventBusMetricsStateSource).toBeNull()
    expect(body.logProjectionHealth).toBeNull()
    expect(body.logProjectionHealthStateSource).toBeNull()
    expect(body.policySummary).toBeNull()
    expect(body.policySummaryStateSource).toBeNull()
  })

  it('POST /api/v0/commands/:commandId/eligibility works for noop', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'sdui-v02-eligibility-leaf', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(
      app,
      '/api/v0/commands/task.noop.submit/eligibility',
      'POST',
      'operator-token',
      { leafNodeId: leafId }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: { id: string }; state: string }
    expect(body.command.id).toBe('task.noop.submit')
    expect(body.state).toBe('enabled')
  })

  it('POST /api/v0/commands/:commandId/eligibility rejects unknown command', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/unknown.cmd/eligibility',
      'POST',
      'operator-token',
      { leafNodeId: 'leaf-placeholder' }
    )
    expect(res.status).toBe(400)
  })

  it('POST /api/v0/commands/:commandId/execute works for noop', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const taskApp = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'sdui-v02-execute-leaf', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp, taskApp)
    const res = await makeRequest(
      app,
      '/api/v0/commands/task.noop.submit/execute',
      'POST',
      'operator-token',
      { leafNodeId: leafId }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      task: { id: string; status: string }
      policyDecisionId: string
      correlationId: string
    }
    expect(body.task.id).toBeDefined()
    expect(body.task.status).toBe('completed')
    expect(body.policyDecisionId).toBeDefined()
    expect(body.correlationId).toBeDefined()
  })

  it('POST /api/v0/commands/:commandId/execute rejects unknown command', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/unknown.cmd/execute',
      'POST',
      'operator-token',
      { leafNodeId: 'leaf-placeholder' }
    )
    expect(res.status).toBe(400)
  })

  it('POST /api/v0/commands/:commandId/eligibility supports approval preview command ids', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/eligibility',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { commandId: string; displayOnly: boolean }
    expect(body.commandId).toBe('policy.approval.approve.preview')
    expect(body.displayOnly).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/execute rejects display-only preview command ids', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.enable.preview/execute',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.display_only')
  })

  it('request permissions are not cached between different tokens in one BFF app', async () => {
    const app = createBffWithCore(createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })))

    const adminApproval = await makeRequest(app, '/api/v0/policy/approvals', 'GET', 'admin-token')
    expect(adminApproval.status).toBe(200)

    const operatorApproval = await makeRequest(
      app,
      '/api/v0/policy/approvals',
      'GET',
      'operator-token'
    )
    expect(operatorApproval.status).toBe(403)
    expect(await operatorApproval.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const adminProfiles = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'admin-token')
    expect(adminProfiles.status).toBe(200)

    const viewerProfiles = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'viewer-token')
    expect(viewerProfiles.status).toBe(403)
    expect(await viewerProfiles.json()).toMatchObject({ error: { code: 'policy.denied' } })
  })
})

describe('SDUI v0.2 BFF OpenAPI', () => {
  it('OpenAPI exposes only UI-facing BFF routes', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })

    const res = await makeRequest(app, '/openapi')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('/api/v0')
  })
})
