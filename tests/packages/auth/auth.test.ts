import { describe, expect, it } from 'bun:test'
import {
  extractBearerToken,
  hashNodeToken,
  isActorId,
  mintActorToken,
  mintLocalToken,
  mintNodeToken,
  verifyLocalToken
} from '../../../packages/auth/src/index.ts'

const testSecret = 'test-secret-key-for-unit-tests'

describe('isActorId', () => {
  it('returns true for known actors', () => {
    expect(isActorId('viewer')).toBe(true)
    expect(isActorId('operator')).toBe(true)
    expect(isActorId('admin')).toBe(true)
    expect(isActorId('security-admin')).toBe(true)
  })

  it('returns false for unknown or non-string values', () => {
    expect(isActorId('unknown')).toBe(false)
    expect(isActorId(1)).toBe(false)
    expect(isActorId(null)).toBe(false)
    expect(isActorId(undefined)).toBe(false)
    expect(isActorId('')).toBe(false)
  })

  it('works as a type guard', () => {
    const value: unknown = 'admin'

    if (!isActorId(value)) {
      throw new Error('expected actor id')
    }

    void mintLocalToken({ actor: value, secret: testSecret })
    expect(value).toBe('admin')
  })
})

describe('extractBearerToken', () => {
  it('extracts token from bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123')
  })

  it('returns null for missing, non-bearer, and empty headers', () => {
    expect(extractBearerToken(undefined)).toBe(null)
    expect(extractBearerToken('Basic abc123')).toBe(null)
    expect(extractBearerToken('')).toBe(null)
  })

  it('is case insensitive', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123')
  })

  it('handles whitespace around token', () => {
    expect(extractBearerToken('  Bearer   abc123  ')).toBe('abc123')
  })
})

describe('mintNodeToken', () => {
  it('returns an opaque node token with the expected prefix', () => {
    const token = mintNodeToken()

    expect(token.startsWith('mnt_')).toBe(true)
    expect(token.length).toBeGreaterThan(32)
  })

  it('generates unique tokens', () => {
    expect(mintNodeToken()).not.toBe(mintNodeToken())
  })
})

describe('hashNodeToken', () => {
  it('returns a sha-256 hex digest', async () => {
    const hash = await hashNodeToken('node-token')

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the same hash for the same input', async () => {
    await expect(hashNodeToken('node-token')).resolves.toBe(await hashNodeToken('node-token'))
  })

  it('returns different hashes for different inputs', async () => {
    await expect(hashNodeToken('node-token-a')).resolves.not.toBe(
      await hashNodeToken('node-token-b')
    )
  })
})

describe('mintLocalToken', () => {
  it('returns a jwt with three dot-separated parts', async () => {
    const token = await mintLocalToken({ actor: 'viewer', secret: testSecret })

    expect(token.split('.')).toHaveLength(3)
  })

  it('mints tokens for valid actors', async () => {
    expect(typeof (await mintLocalToken({ actor: 'viewer', secret: testSecret }))).toBe('string')
    expect(typeof (await mintLocalToken({ actor: 'operator', secret: testSecret }))).toBe('string')
    expect(typeof (await mintLocalToken({ actor: 'admin', secret: testSecret }))).toBe('string')
    expect(typeof (await mintLocalToken({ actor: 'security-admin', secret: testSecret }))).toBe(
      'string'
    )
  })

  it('honors supported expiresIn values', async () => {
    expect(
      typeof (await mintLocalToken({ actor: 'viewer', secret: testSecret, expiresIn: '1h' }))
    ).toBe('string')
  })
})

describe('mintActorToken', () => {
  it('honors numeric expiresIn values', async () => {
    const token = await mintActorToken({
      actor: 'viewer',
      secret: testSecret,
      jti: 'test-jti',
      issuedBy: 'admin',
      purpose: 'unit-test',
      expiresIn: '60'
    })

    expect(token.split('.')).toHaveLength(3)
  })
})

describe('verifyLocalToken', () => {
  it('verifies a minted local token and returns the actor', async () => {
    const token = await mintLocalToken({ actor: 'operator', secret: testSecret })
    const result = await verifyLocalToken({ token, secret: testSecret })

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ ok: true, actor: 'operator' })
  })

  it('returns invalid_token for invalid tokens', async () => {
    await expect(
      verifyLocalToken({ token: 'not-a-token', secret: testSecret })
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_actor for tokens with unknown actors', async () => {
    const token = await mintLocalToken({ actor: 'intruder' as never, secret: testSecret })

    await expect(verifyLocalToken({ token, secret: testSecret })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_actor'
    })
  })
})
