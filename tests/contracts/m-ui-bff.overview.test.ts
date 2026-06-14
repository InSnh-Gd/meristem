import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { MinimalPolicyDecisionSummarySchema } from '../../packages/contracts/src/index.ts'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import {
  CORE_BASE,
  captureOriginalFetch,
  createBffWithCore,
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

describe('M-UI BFF contract tests', () => {
  it('GET /health returns ok', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; service: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('m-ui-bff')
  })

  it('GET /ready returns ready:true when Core is up', async () => {
    const coreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/ready')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ready: boolean }
    expect(body.ready).toBe(true)
  })

  it('GET /api/v0/overview with operator token returns correct shape', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-1', mode: 'simulated' })
      })
    )
    await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'stem', name: 'stem-1', mode: 'simulated' })
      })
    )
    await deps.log.writeTimeline({ summary: 'test log', correlationId: 'cid-1' })

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      session: { actor: string; permissions: string[] }
      core: { id: string; version: string; mode: string }
      nodes: Array<{ id: string }>
      services: Array<{ id: string }>
      timeline: Array<{ id: string }>
      auditAccessible: boolean
    }
    expect(body.session.actor).toBe('operator')
    expect(body.nodes).toHaveLength(2)
    expect(body.timeline.length).toBeGreaterThanOrEqual(1)
    expect(body.auditAccessible).toBe(false)
  })

  it('GET /api/v0/overview with viewer token returns auditAccessible:false', async () => {
    const viewerDeps = createInMemoryCoreDeps({ actor: 'viewer' })
    const viewerApp = createCoreApp(viewerDeps)
    const app = createBffWithCore(viewerApp)

    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'viewer-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      session: { actor: string; permissions: string[] }
      auditAccessible: boolean
    }
    expect(body.session.actor).toBe('viewer')
    expect(body.auditAccessible).toBe(false)
  })

  it('GET /api/v0/overview without token returns error', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/api/v0/overview')
    expect(res.status).toBe(401)
  })

  it('does not expose auth header debug routes from the public BFF', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/api/v0/debug/headers', 'GET', 'operator-token')
    expect(res.status).toBe(404)
  })

  it('GET /api/v0/nodes/:id returns node data', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-1', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, `/api/v0/nodes/${leafId}`, 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { node: { id: string; kind: string; name: string } }
    expect(body.node.id).toBe(leafId)
    expect(body.node.kind).toBe('leaf')
  })

  it('GET /api/v0/policy/decisions/:id/summary returns trimmed response (no reasons)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-policy', mode: 'simulated' })
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

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(
      app,
      `/api/v0/policy/decisions/${execBody.policyDecisionId}/summary`,
      'GET',
      'operator-token'
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      decision: {
        id: string
        actor: string
        action: string
        resource: string
        result: string
        createdAt: string
        reasons?: string[]
      }
    }
    expect(body.decision.id).toBe(execBody.policyDecisionId)
    expect(body.decision.actor).toBeDefined()
    expect(body.decision.action).toBeDefined()
    expect(body.decision.resource).toBeDefined()
    expect(body.decision.result).toBeDefined()
    expect(body.decision.createdAt).toBeDefined()
    expect(
      Either.isRight(Schema.decodeUnknownEither(MinimalPolicyDecisionSummarySchema)(body.decision))
    ).toBe(true)
    expect(body.decision).not.toHaveProperty('reasons')
  })

  it('GET /api/v0/policy/decisions/:id/summary passes through 404 from Core', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/policy/decisions/nonexistent-id/summary',
      'GET',
      'operator-token'
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBeDefined()
  })

  it('GET /api/v0/overview with operator token returns audit:null', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { audit: unknown }
    expect(body.audit).toBeNull()
  })

  it('GET /api/v0/overview with security-admin token returns audit with entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)

    await deps.log.writeAudit({
      actor: 'security-admin',
      action: 'task:submit',
      resource: 'node:1',
      result: 'allow',
      correlationId: 'cid-audit-1'
    })

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'security-admin-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      auditAccessible: boolean
      audit: Array<{
        id: string
        actor: string
        action: string
        resource: string
        result: string
      }> | null
    }
    expect(body.auditAccessible).toBe(true)
    expect(body.audit).not.toBeNull()
    if (body.audit === null) throw new Error('Expected audit entries for accessible audit trail')
    const entries = body.audit
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]?.actor).toBe('security-admin')
    expect(entries[0]?.action).toBe('task:submit')
  })
})
