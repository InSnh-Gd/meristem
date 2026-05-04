import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

describe('Core REST MVP routes', () => {
  it('returns 401 for protected routes without bearer token', async () => {
    const app = createCoreApp(createInMemoryCoreDeps())
    const response = await app.handle(new Request('http://localhost/api/v0/status'))

    expect(response.status).toBe(401)
  })

  it('registers a leaf node for an authorized operator token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf' })
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { node: { kind: string; status: string } }
    expect(body.node.kind).toBe('leaf')
    expect(body.node.status).toBe('healthy')
  })

  it('fails closed when audit write is unavailable for node registration', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator', auditAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
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

  it('registers and lists service definitions for admin actors', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/services', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id: 'sample-service', version: '0.1.0', domain: 'core', kind: 'service' })
      })
    )

    expect(register.status).toBe(200)

    const list = await app.handle(
      new Request('http://localhost/api/v0/services', {
        headers: { authorization: 'Bearer admin-token' }
      })
    )
    const body = await list.json() as { services: unknown[] }
    expect(body.services.length).toBe(1)
  })

  it('returns full logs for operators', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    await deps.log.writeFull({ level: 'info', source: 'test', message: 'full log entry' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/logs/full', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { entries: Array<{ message: string }> }
    expect(body.entries[0]?.message).toBe('full log entry')
  })

  it('returns a policy decision by id', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf' })
      })
    )
    const registered = await register.json() as { policyDecisionId: string }

    const response = await app.handle(
      new Request(`http://localhost/api/v0/policy/decisions/${registered.policyDecisionId}`, {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { decision: { id: string; result: string } }
    expect(body.decision.id).toBe(registered.policyDecisionId)
    expect(body.decision.result).toBe('allow')
  })

  it('creates a network and joins stem and leaf nodes for an authorized operator token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const stemResponse = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'stem', name: 'local-stem' })
      })
    )
    const stemBody = await stemResponse.json() as { node: { id: string } }

    const leafResponse = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf' })
      })
    )
    const leafBody = await leafResponse.json() as { node: { id: string } }

    const createNetworkResponse = await app.handle(
      new Request('http://localhost/api/v0/networks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: 'lab-mesh' })
      })
    )

    expect(createNetworkResponse.status).toBe(200)
    const createdNetwork = await createNetworkResponse.json() as { network: { id: string; name: string } }
    expect(createdNetwork.network.name).toBe('lab-mesh')

    const joinStemResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${createdNetwork.network.id}/members`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ nodeId: stemBody.node.id })
      })
    )
    expect(joinStemResponse.status).toBe(200)

    const joinLeafResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${createdNetwork.network.id}/members`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ nodeId: leafBody.node.id })
      })
    )
    expect(joinLeafResponse.status).toBe(200)
    const joinedLeaf = await joinLeafResponse.json() as { member: { membershipMode: string } }
    expect(joinedLeaf.member.membershipMode).toBe('restricted')

    const membersResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${createdNetwork.network.id}/members`, {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(membersResponse.status).toBe(200)
    const membersBody = await membersResponse.json() as { members: Array<{ nodeId: string }> }
    expect(membersBody.members).toHaveLength(2)
  })
})
