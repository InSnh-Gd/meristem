import { describe, expect, it } from 'bun:test'
import {
  extractBearerToken,
  mintLocalToken,
  verifyLocalToken
} from '../../packages/auth/src/index.ts'

const secret = 'test-secret-with-at-least-thirty-two-characters'

describe('MVP JWT auth', () => {
  it('mints and verifies a local actor token', async () => {
    const token = await mintLocalToken({ actor: 'operator', secret })
    const result = await verifyLocalToken({ token, secret })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.actor).toBe('operator')
  })

  it('rejects a token signed for a different audience', async () => {
    const token = await mintLocalToken({ actor: 'operator', secret, audience: 'other-audience' })
    const result = await verifyLocalToken({ token, secret })

    expect(result.ok).toBe(false)
  })

  it('extracts bearer tokens without trusting malformed auth headers', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def')
    expect(extractBearerToken('Basic abc.def')).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
  })
})
