import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  CreateNetworkResponseSchema,
  FullLogListResponseSchema,
  JoinNetworkResponseSchema,
  NetworkMembersResponseSchema,
  NodeControlResponseSchema,
  PolicyDecisionResponseSchema,
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

async function decodeJson<TSchema extends Schema.Schema.AnyNoContext>(
  response: Response,
  schema: TSchema
): Promise<Schema.Schema.Type<TSchema>> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

describe('Core extended route coverage', () => {
  it('controls nodes through the Core facade for authorized administrators', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'controlled-leaf', mode: 'simulated' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/control`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action: 'disable', reason: 'maintenance window' })
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, NodeControlResponseSchema)
    expect(body.node.id).toBe(registered.node.id)
    expect(body.node.status).toBe('disabled')
    expect(body.policyDecisionId).toBe('mnet-decision-test')
  })

  it('writes an audit fact when Core denies node control before M-Net forwarding', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'denied-control-leaf', mode: 'simulated' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/control`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action: 'disable', reason: 'operator should be denied' })
      })
    )

    expect(response.status).toBe(403)
    const error = await decodeJson(response, ErrorResponseSchema)
    expect(error.error.code).toBe('policy.denied')
    const audit = await deps.log.listAudit()
    expect(audit.ok).toBe(true)
    if (!audit.ok) throw new Error('audit list failed')
    expect(audit.value).toContainEqual(
      expect.objectContaining({
        actor: 'operator',
        action: 'node:disable',
        resource: `node:${registered.node.id}`,
        result: 'deny'
      })
    )
  })

  it('allows admins to switch node roles through the Core facade', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const register = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'promotable-leaf', mode: 'simulated' })
      })
    )
    const registered = await decodeJson(register, RegisterNodeResponseSchema)

    const response = await app.handle(
      new Request(`http://localhost/api/v0/nodes/${registered.node.id}/control`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          action: 'switch-role',
          targetKind: 'stem',
          reason: 'promote to first topology anchor'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, NodeControlResponseSchema)
    expect(body.node.id).toBe(registered.node.id)
    expect(body.node.kind).toBe('stem')
    expect(body.policyDecisionId).toBe('mnet-decision-test')
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
