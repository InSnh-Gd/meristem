import { describe, expect, it } from 'bun:test'
import { formatBffError, normalizeBearerTokenInput } from '../../apps/m-ui/src/lib/bff.ts'

describe('M-UI token entry helpers', () => {
  it('normalizes raw JWTs and pasted Authorization headers to one bearer token', () => {
    expect(normalizeBearerTokenInput('ey.header.payload')).toBe('ey.header.payload')
    expect(normalizeBearerTokenInput('Bearer ey.header.payload')).toBe('ey.header.payload')
    expect(normalizeBearerTokenInput('bearer   ey.header.payload  ')).toBe('ey.header.payload')
  })

  it('surfaces Core and BFF error envelopes instead of hiding them behind a generic message', () => {
    expect(
      formatBffError(
        { error: { code: 'auth.invalid_token', message: 'JWT verification failed' } },
        '加载失败'
      )
    ).toBe('JWT verification failed (auth.invalid_token)')
    expect(formatBffError(new Error('network down'), '加载失败')).toBe('network down')
    expect(formatBffError({ unexpected: true }, '加载失败')).toBe('加载失败')
  })
})
