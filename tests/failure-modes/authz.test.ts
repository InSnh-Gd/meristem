import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

describe('MVP authorization failure modes', () => {
  it('returns 403 when a viewer attempts node registration', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'denied-leaf' })
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns 503 when policy is unavailable for protected operations', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator', policyAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/node-tickets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf' })
      })
    )

    expect(response.status).toBe(503)
  })

  it('returns 403 when a viewer attempts join-ticket creation', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/node-tickets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'denied-leaf' })
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns 403 when a viewer attempts network creation', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/networks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: 'denied-network' })
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns 503 when m-net is unavailable for protected network operations', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator', mNetAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/networks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: 'lab-mesh' })
      })
    )

    expect(response.status).toBe(503)
  })

  it('returns 403 when a viewer attempts service reload', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/services/m-log/reload', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'denied reload' })
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns 403 when a viewer attempts node token issuance', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'denied-leaf', mode: 'simulated' })
      })
    )

    expect(register.status).toBe(403)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes/missing-node/credentials', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token'
        }
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns 409 when agent mode is requested on the public node registration route', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'agent-leaf', mode: 'agent' })
      })
    )

    expect(response.status).toBe(409)
  })

  it('returns 409 when reloading a known non-reloadable service', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/services/m-policy/reload', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'not supported' })
      })
    )

    expect(response.status).toBe(409)
  })

  it('returns 409 when a leaf joins a network without a stem member', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const leafResponse = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf', mode: 'simulated' })
      })
    )
    const leafBody = await leafResponse.json() as { node: { id: string } }

    const networkResponse = await app.handle(
      new Request('http://localhost/api/v0/networks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: 'lab-mesh' })
      })
    )
    const networkBody = await networkResponse.json() as { network: { id: string } }

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkBody.network.id}/members`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ nodeId: leafBody.node.id })
      })
    )

    expect(response.status).toBe(409)
  })
})
