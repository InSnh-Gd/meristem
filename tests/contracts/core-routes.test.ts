import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  CreateNetworkResponseSchema,
  CreateNodeTicketResponseSchema,
  FullLogListResponseSchema,
  IssueNodeCredentialResponseSchema,
  JoinNetworkResponseSchema,
  NetworkMembersResponseSchema,
  PolicyDecisionResponseSchema,
  ReadyResponseSchema,
  RegisterNodeResponseSchema,
  ServiceListResponseSchema,
  ServiceReloadResponseSchema
} from '../../packages/contracts/src/index.ts'
import type { MEventEnvelope } from '../../packages/events/src/index.ts'

const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.optional(Schema.String)
  })
})

const OpenApiOperationSchema = Schema.Struct({
  security: Schema.optional(
    Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
  ),
  responses: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
})

const OpenApiDocumentSchema = Schema.Struct({
  components: Schema.optional(
    Schema.Struct({
      securitySchemes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
    })
  ),
  paths: Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: OpenApiOperationSchema })
  })
})

async function decodeJson<TSchema extends Schema.Schema.AnyNoContext>(
  response: Response,
  schema: TSchema
): Promise<Schema.Schema.Type<TSchema>> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

describe('Core REST MVP routes', () => {
  it('publishes bearer auth and protected-route contracts in OpenAPI', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))

    const response = await app.handle(new Request('http://localhost/openapi/json'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, OpenApiDocumentSchema)

    expect(body.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT'
    })

    expect(body.paths['/api/v0/status']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(body.paths['/api/v0/services']?.post?.security).toEqual([{ bearerAuth: [] }])
    expect(body.paths['/api/v0/services']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(body.paths['/internal/v0/identity/tokens/introspect']).toBeUndefined()
    expect(body.paths['/internal/v0/secrets/{id}/reference']).toBeUndefined()
    expect(body.paths['/internal/v0/secrets/{id}/disable']).toBeUndefined()
    expect(body.paths['/internal/v0/configs/{id}/apply-ack']).toBeUndefined()
    expect(body.paths['/api/v0/tasks']).toBeUndefined()
    expect(body.paths['/api/v0/extensions']).toBeUndefined()
    expect(body.paths['/api/v0/extensions/{id}']).toBeUndefined()
    expect(body.paths['/api/v0/logs/full']?.get?.security).toEqual([{ bearerAuth: [] }])

    expect(body.paths['/api/v0/status']?.get?.responses?.['200']).toBeDefined()
    expect(body.paths['/api/v0/node-tickets']?.post?.responses?.['200']).toBeDefined()
    expect(body.paths['/api/v0/nodes']?.post?.responses?.['200']).toBeDefined()
  })

  it('reports readiness across postgres, nats, and internal services', async () => {
    const deps = createInMemoryCoreDeps()
    deps.storage.readiness = async () => ({
      postgres: 'ready',
      nats: 'ready',
      'm-policy': 'ready',
      'm-log': 'ready',
      'm-eventbus': 'unavailable',
      'm-net': 'ready'
    })
    const app = createCoreApp(deps)

    const response = await app.handle(new Request('http://localhost/api/v0/ready'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, ReadyResponseSchema)
    expect(body.ready).toBe(false)
    expect(body.dependencies['m-policy']).toBe('ready')
    expect(body.dependencies['m-eventbus']).toBe('unavailable')
    expect(body.dependencies['m-net']).toBe('ready')
  })

  it('returns 401 for protected routes without bearer token', async () => {
    const app = createCoreApp(createInMemoryCoreDeps())
    const response = await app.handle(new Request('http://localhost/api/v0/status'))

    expect(response.status).toBe(401)
  })

  it('creates a join ticket for an authorized operator token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const published: Array<{ subject: string; event: MEventEnvelope }> = []
    const publish = deps.events.publish
    deps.events.publish = async (subject, event) => {
      published.push({ subject, event })
      return publish(subject, event)
    }
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

    expect(response.status).toBe(200)
    const body = await decodeJson(response, CreateNodeTicketResponseSchema)
    expect(body.ticketId.length).toBeGreaterThan(10)
    expect(body.ticket.startsWith('mjt_')).toBe(true)
    expect(body.expiresAt.length).toBeGreaterThan(10)
    expect(body.joinUrl).toBe('wss://localhost:8443/join/v0/session')
    expect(published.map(entry => entry.subject)).toEqual([
      'node.registration.requested.v0',
      'node.join-ticket.created.v0'
    ])
  })

  it('registers a simulated leaf node for an authorized operator token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'sim-leaf' })
      })
    )

    const body = await decodeJson(response, RegisterNodeResponseSchema)
    expect(response.status).toBe(200)
    expect(body.node.kind).toBe('leaf')
    expect(body.node.status).toBe('healthy')
    expect(body.node.mode).toBe('simulated')
    expect(body.node.reachability).toBe('reachable')
  })

  it('rejects agent mode on the public node registration route', async () => {
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
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('node.agent_join_ticket_required')
    expect(body.error.message).toContain('node ticket')
  })

  it('issues a node credential for an operator and returns the token once', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'sim-leaf' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token'
        }
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, IssueNodeCredentialResponseSchema)
    expect(body.nodeId).toBe(registered.node.id)
    expect(body.token.length).toBeGreaterThan(20)
    expect(body.issuedAt.length).toBeGreaterThan(10)
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
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf', mode: 'simulated' })
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
        body: JSON.stringify({
          id: 'sample-service',
          version: '0.1.0',
          domain: 'core',
          kind: 'service'
        })
      })
    )

    expect(register.status).toBe(200)

    const list = await app.handle(
      new Request('http://localhost/api/v0/services', {
        headers: { authorization: 'Bearer admin-token' }
      })
    )
    const body = await decodeJson(list, ServiceListResponseSchema)
    expect(
      body.services.some(
        (service: (typeof body.services)[number]) => service.id === 'sample-service'
      )
    ).toBe(true)
    expect(
      body.services.some((service: (typeof body.services)[number]) => service.id === 'm-log')
    ).toBe(true)
  })

  it('lists built-in service runtime and reloads m-log for an operator', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const published: Array<{ subject: string; event: MEventEnvelope }> = []
    const publish = deps.events.publish
    deps.events.publish = async (subject, event) => {
      published.push({ subject, event })
      return publish(subject, event)
    }
    const app = createCoreApp(deps)

    const list = await app.handle(
      new Request('http://localhost/api/v0/services', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(list.status).toBe(200)
    const servicesBody = await decodeJson(list, ServiceListResponseSchema)
    const mLog = servicesBody.services.find(
      (service: (typeof servicesBody.services)[number]) => service.id === 'm-log'
    )
    expect(mLog?.lifecycle.reloadable).toBe(true)
    expect(mLog?.runtime?.mode).toBe('normal')

    const reload = await app.handle(
      new Request('http://localhost/api/v0/services/m-log/reload', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'test reload' })
      })
    )

    expect(reload.status).toBe(200)
    const reloadBody = await decodeJson(reload, ServiceReloadResponseSchema)
    expect(reloadBody.serviceId).toBe('m-log')
    expect(reloadBody.accepted).toBe(true)
    expect(published.map(entry => entry.subject)).toContain('service.lifecycle.reload.requested.v0')
  })

  it('does not expose canonical task routes after the M-Task cutover', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/tasks', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ nodeId: 'node-leaf-1', type: 'noop' })
      })
    )

    expect(response.status).toBe(404)
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
    const body = await decodeJson(response, FullLogListResponseSchema)
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
        body: JSON.stringify({ kind: 'leaf', name: 'local-leaf', mode: 'simulated' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/policy/decisions/${registered.policyDecisionId}`, {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, PolicyDecisionResponseSchema)
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
        body: JSON.stringify({ kind: 'stem', name: 'local-stem', mode: 'simulated' })
      })
    )
    const stemBody = await decodeJson(stemResponse, RegisterNodeResponseSchema)

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
    const leafBody = await decodeJson(leafResponse, RegisterNodeResponseSchema)

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
    const createdNetwork = await decodeJson(createNetworkResponse, CreateNetworkResponseSchema)
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
    const joinedLeaf = await decodeJson(joinLeafResponse, JoinNetworkResponseSchema)
    expect(joinedLeaf.member.membershipMode).toBe('restricted')

    const membersResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${createdNetwork.network.id}/members`, {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(membersResponse.status).toBe(200)
    const membersBody = await decodeJson(membersResponse, NetworkMembersResponseSchema)
    expect(membersBody.members).toHaveLength(2)
  })
})
