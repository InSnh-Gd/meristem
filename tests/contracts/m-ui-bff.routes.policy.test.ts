import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  createInMemoryMTaskDeps,
  createMTaskApp,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerRoutesPolicyContractTests(): void {
  describe('SDUI v0.2 BFF routes', () => {
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
  })
}
