import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import {
  captureOriginalFetch,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest,
  restoreOriginalFetch
} from '../contracts/_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

/** 提供故障模式场景用的最小 M-Net mock。 */
function createFailureModeMNetApp() {
  return new Elysia()
    .post('/api/v0/networks/network-cn-001/break-glass', () => {
      return new Response(
        JSON.stringify({
          error: { code: 'mnet.break_glass.denied', message: 'break-glass denied' }
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    })
    .post('/api/v0/networks/profile-switches/op-1/apply', () => {
      return new Response(
        JSON.stringify({ error: { code: 'mnet.unavailable', message: 'm-net unavailable' } }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    })
}

describe('M-UI BFF M-Net command failure modes', () => {
  it('break-glass execute without confirmation returns validation error and does not call upstream', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
      mnetApp: createFailureModeMNetApp()
    })

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    try {
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.break-glass.execute/execute',
        'POST',
        'security-admin-token',
        { networkId: 'network-cn-001' }
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'command.invalid_body' } })
      expect(requests.filter(request => request.method !== 'GET')).toHaveLength(0)
    } finally {
      globalThis.fetch = delegatedFetch
    }
  })

  it('viewer eligibility returns disabled reason and does not call upstream mutation', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' })),
      mnetApp: createFailureModeMNetApp()
    })

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    try {
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.join-ticket.create.execute/eligibility',
        'POST',
        'viewer-token',
        { networkId: 'network-cn-001' }
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        state: 'disabled',
        disabledReason: '缺少权限：node:register'
      })
      expect(requests.every(request => request.method === 'GET')).toBe(true)
    } finally {
      globalThis.fetch = delegatedFetch
    }
  })

  it('Core facade errors are returned as typed error envelopes', async () => {
    const app = createBffWithServices({
      coreApp: createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })),
      mnetApp: createFailureModeMNetApp()
    })

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.migration.apply.execute/execute',
      'POST',
      'admin-token',
      { operationId: 'op-1' }
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'feature.unavailable' } })
  })
})
