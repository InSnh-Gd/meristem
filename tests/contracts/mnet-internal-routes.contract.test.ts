import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type {
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeAgentTaskExecuteResponse
} from '../../packages/contracts/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import type { MNetAppDeps } from '../../services/m-net/src/deps.ts'
import { createInternalRoutes } from '../../services/m-net/src/internal-routes.ts'

type InternalRouteDeps = Pick<
  MNetAppDeps,
  'createNetwork' | 'listNetworks' | 'joinNetwork' | 'listMembers' | 'executeNoop'
>

type CapturedCalls = {
  createNetwork: Parameters<InternalRouteDeps['createNetwork']>[0][]
  joinNetwork: Parameters<InternalRouteDeps['joinNetwork']>[0][]
  listMembers: Parameters<InternalRouteDeps['listMembers']>[0][]
  executeNoop: Parameters<InternalRouteDeps['executeNoop']>[0][]
}

const originalInternalToken = process.env.MERISTEM_INTERNAL_TOKEN
const originalOtelExporter = process.env.MERISTEM_OTEL_EXPORTER
const internalToken = 'mnet-internal-route-test-token'

const networkFixture = {
  id: 'network-1',
  name: 'primary network',
  profileVersion: 'm-net-default@0.1.0',
  status: 'active',
  createdAt: '2026-06-18T00:00:00.000Z'
} satisfies MNetwork

const networkSummaryFixture = {
  ...networkFixture,
  memberCount: 2
} satisfies NetworkSummary

const memberFixture = {
  networkId: 'network-1',
  nodeId: 'leaf-1',
  nodeKind: 'leaf',
  membershipMode: 'restricted',
  status: 'joined',
  joinedAt: '2026-06-18T00:01:00.000Z'
} satisfies MNetworkMember

const taskResultFixture = {
  nodeId: 'leaf-1',
  taskId: 'demo-internal-task',
  result: 'completed',
  completedAt: '2026-06-18T00:02:00.000Z'
} satisfies NodeAgentTaskExecuteResponse

function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

function jsonRequest(path: string, method: 'POST', body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { ...internalHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: internalHeaders() })
}

function createRouteFixture(overrides: Partial<InternalRouteDeps> = {}) {
  const calls: CapturedCalls = {
    createNetwork: [],
    joinNetwork: [],
    listMembers: [],
    executeNoop: []
  }

  const defaultDeps: InternalRouteDeps = {
    async createNetwork(input) {
      calls.createNetwork.push(input)
      return { ok: true, value: networkFixture }
    },
    async listNetworks() {
      return { ok: true, value: [networkSummaryFixture] }
    },
    async joinNetwork(input) {
      calls.joinNetwork.push(input)
      return { ok: true, value: memberFixture }
    },
    async listMembers(input) {
      calls.listMembers.push(input)
      return { ok: true, value: [memberFixture] }
    },
    async executeNoop(input) {
      calls.executeNoop.push(input)
      return { ok: true, value: taskResultFixture }
    }
  }

  return { app: createInternalRoutes({ ...defaultDeps, ...overrides }), calls }
}

async function expectJson(response: Response, expected: unknown) {
  expect(await response.json()).toEqual(expected)
}

describe('M-Net internal route contracts', () => {
  beforeEach(() => {
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
    process.env.MERISTEM_OTEL_EXPORTER = 'none'
  })

  afterEach(() => {
    if (originalInternalToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
    else process.env.MERISTEM_INTERNAL_TOKEN = originalInternalToken

    if (originalOtelExporter === undefined) delete process.env.MERISTEM_OTEL_EXPORTER
    else process.env.MERISTEM_OTEL_EXPORTER = originalOtelExporter
  })

  it('POST /internal/v0/networks validates the internal token and creates a network', async () => {
    const { app, calls } = createRouteFixture()

    const response = await app.handle(
      jsonRequest('/internal/v0/networks', 'POST', {
        name: 'primary network',
        profileVersion: 'm-net-default@0.1.0'
      })
    )

    expect(response.status).toBe(200)
    await expectJson(response, { network: networkFixture })
    expect(calls.createNetwork).toEqual([
      { name: 'primary network', profileVersion: 'm-net-default@0.1.0' }
    ])
  })

  it('GET /internal/v0/networks returns network summaries', async () => {
    const { app } = createRouteFixture()

    const response = await app.handle(getRequest('/internal/v0/networks'))

    expect(response.status).toBe(200)
    await expectJson(response, { networks: [networkSummaryFixture] })
  })

  it('POST /internal/v0/networks/:id/members joins a node to the target network', async () => {
    const { app, calls } = createRouteFixture()

    const response = await app.handle(
      jsonRequest('/internal/v0/networks/network-1/members', 'POST', { nodeId: 'leaf-1' })
    )

    expect(response.status).toBe(200)
    await expectJson(response, { member: memberFixture })
    expect(calls.joinNetwork).toEqual([{ networkId: 'network-1', nodeId: 'leaf-1' }])
  })

  it('GET /internal/v0/networks/:id/members lists network members', async () => {
    const { app, calls } = createRouteFixture()

    const response = await app.handle(getRequest('/internal/v0/networks/network-1/members'))

    expect(response.status).toBe(200)
    await expectJson(response, { members: [memberFixture] })
    expect(calls.listMembers).toEqual([{ networkId: 'network-1' }])
  })

  it('POST /internal/v0/tasks/noop executes a noop task without requiring an external task type field', async () => {
    const { app, calls } = createRouteFixture()

    const response = await app.handle(
      jsonRequest('/internal/v0/tasks/noop', 'POST', {
        nodeId: 'leaf-1',
        taskId: 'demo-internal-task',
        correlationId: 'corr-1'
      })
    )

    expect(response.status).toBe(200)
    await expectJson(response, { result: taskResultFixture })
    expect(calls.executeNoop).toEqual([
      { nodeId: 'leaf-1', taskId: 'demo-internal-task', correlationId: 'corr-1' }
    ])
  })

  it('returns 401 before service calls when the internal token is missing', async () => {
    const { app, calls } = createRouteFixture()

    const response = await app.handle(
      new Request('http://localhost/internal/v0/networks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'primary network' })
      })
    )

    expect(response.status).toBe(401)
    await expectJson(response, {
      error: { code: 'internal.unauthorized', message: 'invalid internal token' }
    })
    expect(calls.createNetwork).toEqual([])
  })

  it('maps M-Net service errors to the documented internal HTTP status codes', async () => {
    const { app } = createRouteFixture({
      async createNetwork() {
        return { ok: false, error: { code: 'network.conflict', message: 'network exists' } }
      },
      async listMembers() {
        return { ok: false, error: { code: 'network.not_found', message: 'network missing' } }
      },
      async executeNoop() {
        return { ok: false, error: { code: 'node.transport_down', message: 'transport down' } }
      }
    })

    const conflict = await app.handle(
      jsonRequest('/internal/v0/networks', 'POST', { name: 'primary network' })
    )
    expect(conflict.status).toBe(409)
    await expectJson(conflict, {
      error: { code: 'network.conflict', message: 'network exists' }
    })

    const notFound = await app.handle(getRequest('/internal/v0/networks/network-404/members'))
    expect(notFound.status).toBe(404)
    await expectJson(notFound, {
      error: { code: 'network.not_found', message: 'network missing' }
    })

    const unavailable = await app.handle(
      jsonRequest('/internal/v0/tasks/noop', 'POST', {
        nodeId: 'leaf-1',
        taskId: 'demo-internal-task',
        correlationId: 'corr-1'
      })
    )
    expect(unavailable.status).toBe(503)
    await expectJson(unavailable, {
      error: { code: 'node.transport_down', message: 'transport down' }
    })
  })
})
