import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerRoutesNetworkProfilesContractTests(): void {
  describe('SDUI v0.2 BFF routes', () => {
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
        'm-net-cn@0.3.0',
        'm-net@0.3.0'
      ])
      const cnProfile = body.profiles.find(profile => profile.profileVersion === 'm-net-cn@0.3.0')
      expect(cnProfile?.stateSource.sourceId).toBe('core:/api/v0/network-profiles/m-net-cn@0.3.0')
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
        '/api/v0/network-profiles/m-net-cn@0.3.0',
        'GET',
        'admin-token'
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        profileVersion: string
        stateSource: { sourceType: string; sourceId: string }
      }
      expect(body.profileVersion).toBe('m-net-cn@0.3.0')
      expect(body.stateSource).toEqual({
        sourceType: 'authoritative',
        sourceId: 'core:/api/v0/network-profiles/m-net-cn@0.3.0'
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
  })
}
