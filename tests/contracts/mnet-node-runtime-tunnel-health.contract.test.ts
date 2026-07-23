import { describe, expect, it } from 'bun:test'
import { createNodeRuntimeRoutes } from '../../services/m-net/src/node-runtime-routes.ts'

const nodeId = 'leaf-tunnel-reporter'
const checkedAt = '2026-07-24T12:00:00.000Z'

function createFixture() {
  const reports: unknown[] = []
  const app = createNodeRuntimeRoutes({
    nodeRuntime: {
      async authorize(expectedNodeId, token) {
        return expectedNodeId === nodeId && token === 'node-runtime-token'
      },
      async fetchLatestNetworkMap() {
        return {
          kind: 'failure',
          status: 404,
          error: { code: 'test.not_used', message: 'not used' }
        }
      },
      async registerNodePublicKey() {
        return {
          kind: 'failure',
          status: 404,
          error: { code: 'test.not_used', message: 'not used' }
        }
      },
      async reportTunnelHealth(input) {
        reports.push(input)
        return {
          kind: 'mutation',
          contractVersion: 'mnet-closed-loop-mutation@0.1.0',
          value: {
            ...input.health,
            nodeId: input.nodeId,
            stateSource: 'node-runtime-report'
          },
          publication: { status: 'published', pendingSubjects: [] }
        }
      }
    }
  })
  return { app, reports }
}

function request(body: unknown, authorized = true): Request {
  return new Request(`http://localhost/api/v0/node-runtime/nodes/${nodeId}/tunnel-health`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer node-runtime-token' } : {})
    },
    body: JSON.stringify(body)
  })
}

const validBody = {
  peerNodeId: 'stem-tunnel-peer',
  status: 'up',
  mode: 'direct',
  latencyMs: 12,
  packetLossPct: 0,
  relayStatus: 'not-required',
  checkedAt
}

describe('M-Net node-runtime tunnel health route', () => {
  it('requires the node runtime trust boundary and derives the authoritative node identity', async () => {
    const fixture = createFixture()
    const unauthenticated = await fixture.app.handle(request(validBody, false))
    expect(unauthenticated.status).toBe(401)
    expect(fixture.reports).toEqual([])

    const response = await fixture.app.handle(request(validBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      kind: 'mutation',
      value: { nodeId, peerNodeId: 'stem-tunnel-peer', stateSource: 'node-runtime-report' }
    })
    expect(fixture.reports).toEqual([{ nodeId, health: validBody }])
  })

  it('rejects malformed tunnel telemetry before invoking the reporter', async () => {
    const fixture = createFixture()
    const response = await fixture.app.handle(
      request({ ...validBody, packetLossPct: 101 })
    )
    expect(response.status).toBe(422)
    expect(fixture.reports).toEqual([])
  })
})
