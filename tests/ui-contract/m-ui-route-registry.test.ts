import { describe, expect, it } from 'bun:test'
import { SDUI_V02_ROUTE_REGISTRY } from '../../services/m-ui-bff/src/routes/route-registry.ts'

describe('M-UI Route Registry Contract', () => {
  it('all routes declare requiredPermissions and stateSources', () => {
    for (const route of SDUI_V02_ROUTE_REGISTRY.routes) {
      expect(route.requiredPermissions).toBeDefined()
      expect(route.requiredPermissions.length).toBeGreaterThan(0)
      expect(route.stateSources).toBeDefined()
      expect(route.stateSources.length).toBeGreaterThan(0)
    }
  })

  it('high-risk routes (break-glass, credential revoke, profile migration) declare permissions and state sources', () => {
    const breakGlass = SDUI_V02_ROUTE_REGISTRY.routes.find(r => r.id === 'mnet.break-glass')
    expect(breakGlass).toBeDefined()
    expect(breakGlass?.requiredPermissions).toContain('network:profile-disable')
    expect(breakGlass?.stateSources).toContain('authoritative')

    const credentials = SDUI_V02_ROUTE_REGISTRY.routes.find(r => r.id === 'nodes.credentials')
    expect(credentials).toBeDefined()
    expect(credentials?.requiredPermissions.length).toBeGreaterThan(0)
    expect(credentials?.stateSources).toContain('authoritative')

    const migration = SDUI_V02_ROUTE_REGISTRY.routes.find(r => r.id === 'mnet.profile.migration')
    expect(migration).toBeDefined()
    expect(migration?.requiredPermissions).toContain('network:profile-enable')
    expect(migration?.stateSources).toContain('policy')
  })
})
