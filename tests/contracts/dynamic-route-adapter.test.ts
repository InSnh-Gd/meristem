import { afterEach, describe, expect, it } from 'bun:test'
import { createDynamicRouteAdapter } from '../../packages/internal-http/src/dynamic-routes.ts'

const originalFetch = globalThis.fetch

function mockFetch(handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): typeof fetch {
  return Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('DynamicRouteAdapter', () => {
  it('encodes path segments, serializes query, and injects headers', async () => {
    const requests: Request[] = []
    globalThis.fetch = mockFetch(async (input, init) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
      requests.push(request)
      return Response.json({ ok: true })
    })

    const adapter = createDynamicRouteAdapter({
      baseUrl: 'http://core.local',
      defaultHeaders: { authorization: 'Bearer token' },
      traceHeaders: () => ({ traceparent: 'trace-1' })
    })

    const result = await adapter.getJson('/api/v0/nodes/:nodeId/logs', {
      params: { nodeId: 'leaf/1' },
      query: { limit: 10, includeAudit: false, empty: undefined }
    })

    expect(result.ok).toBe(true)
    expect(requests[0]!.url).toBe('http://core.local/api/v0/nodes/leaf%2F1/logs?limit=10&includeAudit=false')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer token')
    expect(requests[0]!.headers.get('traceparent')).toBe('trace-1')
  })

  it('extracts Meristem error envelopes and JSON parse failures', async () => {
    globalThis.fetch = mockFetch(async () => new Response('{bad json', { status: 200 }))
    const adapter = createDynamicRouteAdapter({ baseUrl: 'http://core.local' })

    const parseResult = await adapter.postJson('/api/v0/projection/dlq/:id/replay', {
      params: { id: 'dlq-1' },
      body: {}
    })
    expect(parseResult.ok).toBe(false)
    expect(parseResult.ok ? '' : parseResult.error.code).toBe('http.invalid_json')

    globalThis.fetch = mockFetch(async () => Response.json({ error: { code: 'projection.denied', message: 'denied' } }, { status: 403 }))
    const errorResult = await adapter.postJson('/api/v0/projection/dlq/:id/replay', {
      params: { id: 'dlq-1' }
    })
    expect(errorResult.ok).toBe(false)
    expect(errorResult.ok ? '' : errorResult.error.code).toBe('projection.denied')
    expect(errorResult.ok ? '' : errorResult.error.message).toBe('denied')
  })
})
