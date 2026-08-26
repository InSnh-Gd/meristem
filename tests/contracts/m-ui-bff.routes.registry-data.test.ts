import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerRoutesRegistryDataContractTests(): void {
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
  })
}
