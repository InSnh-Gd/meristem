import { describe, expect, it } from 'bun:test'
import { createClosedLoopRoutes } from '@m-net/closed-loop/closed-loop-routes.ts'
import { createInMemoryMNetClosedLoopStore } from '@m-net/closed-loop/closed-loop-store-memory.ts'
import { createMNetClosedLoopService } from '@m-net/closed-loop/closed-loop-workflow.ts'
import { createInMemoryDataPlaneStores } from '@m-net/data-plane/data-plane-store-memory.ts'

const networkId = 'network-closed-loop-routes'
const startedAt = '2026-07-21T10:00:00.000Z'

function createFixture() {
  const store = createInMemoryMNetClosedLoopStore()
  const service = createMNetClosedLoopService({
    store,
    dataPlane: createInMemoryDataPlaneStores(),
    now: () => new Date(startedAt),
    policy: {
      async authorize(_actor, action) {
        return action === 'network:join'
          ? { result: 'allow', id: 'policy-join-allowed', reasons: ['join request allowed'] }
          : { result: 'deny', id: 'policy-denied', reasons: ['route contract denial'] }
      }
    },
    log: {
      async writeAudit() {},
      async writeTimeline() {},
      async writeFull() {}
    },
    events: { async publish() {} },
    credentials: {
      async issue() {
        return { ok: false, code: 'test.not_used', message: 'not used' }
      },
      async rotate() {
        return { ok: false, code: 'test.not_used', message: 'not used' }
      },
      async revoke() {
        return { ok: true }
      }
    },
    network: {
      async listNetworks() {
        return { ok: true, value: [] }
      },
      async listMembers() {
        return { ok: true, value: [] }
      }
    },
    migration: {
      async apply() {
        return { ok: true, appliedNetworkIds: [] }
      },
      async rollback() {
        return { ok: true, appliedNetworkIds: [] }
      }
    }
  })
  const app = createClosedLoopRoutes({
    closedLoop: service,
    auth: {
      async verify(token) {
        return token === 'valid-token'
          ? { ok: true, actor: 'operator' }
          : { ok: false, code: 'invalid_token', message: 'invalid token' }
      }
    }
  })
  return { app, store }
}

function jsonRequest(path: string, body: unknown, authorized = true): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer valid-token' } : {})
    },
    body: JSON.stringify(body)
  })
}

describe('M-Net closed-loop routes', () => {
  it('authenticates before mutation and returns committed denial facts unchanged', async () => {
    const fixture = createFixture()
    const joinBody = {
      requestId: 'join-route-contract',
      networkId,
      nodeId: 'leaf-route-contract',
      requestedNodeKind: 'leaf',
      requestedProfileVersion: 'm-net-cn@0.3.0',
      expiresAt: '2026-07-21T11:00:00.000Z'
    }

    const unauthenticated = await fixture.app.handle(
      jsonRequest('/api/v0/mnet/closed-loop/join-requests', joinBody, false)
    )
    expect(unauthenticated.status).toBe(401)
    expect(await fixture.store.joins.get(joinBody.requestId)).toBeNull()

    const submitted = await fixture.app.handle(
      jsonRequest('/api/v0/mnet/closed-loop/join-requests', joinBody)
    )
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({
      kind: 'mutation',
      contractVersion: 'mnet-closed-loop-mutation@0.1.0',
      value: { requestId: joinBody.requestId, status: 'pending' },
      publication: { status: 'published', pendingSubjects: [] }
    })
    expect(await fixture.store.joins.get(joinBody.requestId)).toMatchObject({ status: 'pending' })

    const denied = await fixture.app.handle(
      new Request(`http://localhost/api/v0/mnet/closed-loop/networks/${networkId}/relay-policy`, {
        method: 'PUT',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          state: 'enabled',
          routeClass: 'forced-tcp-relay',
          selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
          reason: 'route contract denial',
          affectedNodeIds: ['leaf-route-contract']
        })
      })
    )
    expect(denied.status).toBe(200)
    expect(await denied.json()).toMatchObject({ result: 'denied', sideEffect: 'none' })
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
  })

  it('rejects malformed join input and exposes no public tunnel-health writer', async () => {
    const fixture = createFixture()
    const malformed = await fixture.app.handle(
      jsonRequest('/api/v0/mnet/closed-loop/join-requests', {
        requestId: 'join-malformed',
        networkId,
        nodeId: 'leaf-malformed',
        requestedNodeKind: 'leaf',
        requestedProfileVersion: 'm-net-cn@0.3.0'
      })
    )
    expect(malformed.status).toBe(422)
    expect(await fixture.store.joins.get('join-malformed')).toBeNull()

    const invalidCorrelation = await fixture.app.handle(
      new Request('http://localhost/api/v0/mnet/closed-loop/join-requests', {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-correlation-id': 'x'.repeat(129)
        },
        body: JSON.stringify({
          requestId: 'join-invalid-correlation',
          networkId,
          nodeId: 'leaf-invalid-correlation',
          requestedNodeKind: 'leaf',
          requestedProfileVersion: 'm-net-cn@0.3.0',
          expiresAt: '2026-07-21T11:00:00.000Z'
        })
      })
    )
    expect(invalidCorrelation.status).toBe(400)
    expect(await invalidCorrelation.json()).toMatchObject({
      error: { code: 'request.invalid_correlation_id' }
    })
    expect(await fixture.store.joins.get('join-invalid-correlation')).toBeNull()

    const publicTunnelWrite = await fixture.app.handle(
      jsonRequest(`/api/v0/mnet/closed-loop/networks/${networkId}/tunnel-health`, {
        nodeId: 'leaf-route-contract',
        peerNodeId: 'stem-route-contract',
        status: 'up',
        mode: 'direct',
        relayStatus: 'not-required',
        checkedAt: startedAt,
        stateSource: 'opensearch-projection'
      })
    )
    expect(publicTunnelWrite.status).toBe(404)
  })
})
