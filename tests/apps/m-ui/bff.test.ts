import { describe, expect, it } from 'bun:test'
import { formatBffError, normalizeBearerTokenInput } from '../../../apps/m-ui/src/lib/bff.ts'

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
