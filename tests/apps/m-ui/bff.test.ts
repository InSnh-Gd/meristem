import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  bffFetch,
  formatBffError,
  normalizeBearerTokenInput
} from '../../../apps/m-ui/src/lib/bff.ts'

describe('normalizeBearerTokenInput', () => {
  it('strips Bearer prefix case insensitively and trims whitespace', () => {
    expect(normalizeBearerTokenInput('Bearer token-value')).toBe('token-value')
    expect(normalizeBearerTokenInput('bearer token-value')).toBe('token-value')
    expect(normalizeBearerTokenInput('  BEARER token-value  ')).toBe('token-value')
    expect(normalizeBearerTokenInput('Bearer   token-value  ')).toBe('token-value')
  })

  it('preserves plain tokens and handles empty string', () => {
    expect(normalizeBearerTokenInput('token-value')).toBe('token-value')
    expect(normalizeBearerTokenInput('  token-value  ')).toBe('token-value')
    expect(normalizeBearerTokenInput('')).toBe('')
    expect(normalizeBearerTokenInput('   ')).toBe('')
  })
})

describe('formatBffError', () => {
  it('returns message from Error instances', () => {
    expect(formatBffError(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('formats BFF error envelopes with code and message', () => {
    expect(
      formatBffError({ error: { code: 'core.unauthorized', message: 'denied' } }, 'fallback')
    ).toBe('denied (core.unauthorized)')
  })

  it('formats BFF error envelopes without code as message only', () => {
    expect(formatBffError({ error: { message: 'denied' } }, 'fallback')).toBe('denied')
  })

  it('returns fallback for non-object, null, and undefined values', () => {
    expect(formatBffError('bad', 'fallback')).toBe('fallback')
    expect(formatBffError(null, 'fallback')).toBe('fallback')
    expect(formatBffError(undefined, 'fallback')).toBe('fallback')
  })
})

describe('bffFetch', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends GET with normalized token and JSON content-type, returns parsed body', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: 'ok' }), { status: 200 }))
    )
    globalThis.fetch = mockFetch

    const result = await bffFetch('/api/v0/test', 'Bearer my-token')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3200/api/v0/test')
    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer my-token')
    expect(headers['content-type']).toBe('application/json')
    expect(result).toEqual({ data: 'ok' })
  })

  it('throws error envelope on non-ok response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'test.error', message: 'denied' } }), {
          status: 403
        })
      )
    )

    await expect(bffFetch('/api/v0/policy', 'token')).rejects.toEqual({
      error: { code: 'test.error', message: 'denied' }
    })
  })

  it('throws fallback envelope when error response body is not valid JSON', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('internal server error', { status: 500 }))
    )

    await expect(bffFetch('/api/v0/broken', 'token')).rejects.toEqual({
      error: { code: 'unknown', message: 'request failed' }
    })
  })

  it('omits authorization header when token is empty', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    globalThis.fetch = mockFetch

    await bffFetch('/api/v0/test', '')

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
  })

  it('passes through extra init options such as method and body', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    globalThis.fetch = mockFetch

    const body = JSON.stringify({ leafNodeId: 'node-1' })
    await bffFetch('/api/v0/commands/submit/execute', 'token', {
      method: 'POST',
      body
    })

    const options = mockFetch.mock.calls[0][1] as RequestInit
    expect(options.method).toBe('POST')
    expect(options.body).toBe(body)
  })
})
