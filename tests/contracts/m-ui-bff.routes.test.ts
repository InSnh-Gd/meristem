import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import {
  CORE_BASE,
  captureOriginalFetch,
  createBffWithCore,
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

describe('SDUI v0.2 BFF routes', () => {
  it('GET /api/v0/routes returns route registry', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { routes: Array<{ id: string }> }
    expect(Array.isArray(body.routes)).toBe(true)
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

  it('GET /api/v0/services returns service list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/services', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { services: Array<{ id: string }> }
    expect(Array.isArray(body.services)).toBe(true)
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
