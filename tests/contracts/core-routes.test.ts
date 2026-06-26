import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  CreateNodeTicketResponseSchema,
  IssueNodeCredentialResponseSchema,
  ReadyResponseSchema,
  RegisterNodeResponseSchema,
  RevokeNodeCredentialResponseSchema
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

  it('rotates a node runtime credential and invalidates the previous token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'rotating-leaf' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const firstResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const first = await decodeJson(firstResponse, IssueNodeCredentialResponseSchema)

    const secondResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const second = await decodeJson(secondResponse, IssueNodeCredentialResponseSchema)

    expect(await deps.storage.validateNodeCredential(registered.node.id, first.token)).toBe(false)
    expect(await deps.storage.validateNodeCredential(registered.node.id, second.token)).toBe(true)
  })

  it('revokes the active node runtime credential and invalidates the current token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'revoking-leaf' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const issueResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const issued = await decodeJson(issueResponse, IssueNodeCredentialResponseSchema)

    const revokeResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials/revoke`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(revokeResponse.status).toBe(200)
    const body = await decodeJson(revokeResponse, RevokeNodeCredentialResponseSchema)
    expect(body.nodeId).toBe(registered.node.id)
    expect(body.revokedAt.length).toBeGreaterThan(10)
    expect(await deps.storage.validateNodeCredential(registered.node.id, issued.token)).toBe(false)
  })

  it('returns 404 when revoking a runtime credential for a missing node', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/nodes/missing-node/credentials/revoke', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(404)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('node.not_found')
  })

  it('returns 409 when revoking a node with no active runtime credential', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'no-active-token-leaf' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials/revoke`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(409)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('node.credential_not_active')
  })

  it('does not revoke the active credential when policy denies the revoke request', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'denied-revoke-leaf' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const issueResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const issued = await decodeJson(issueResponse, IssueNodeCredentialResponseSchema)

    const deniedResponse = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/credentials/revoke`, {
        method: 'POST',
        headers: { authorization: 'Bearer viewer-token' }
      })
    )

    expect(deniedResponse.status).toBe(403)
    const denied = await decodeJson(deniedResponse, ErrorResponseSchema)
    expect(denied.error.code).toBe('policy.denied')
    expect(await deps.storage.validateNodeCredential(registered.node.id, issued.token)).toBe(true)
  })
})
