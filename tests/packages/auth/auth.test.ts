import { describe, expect, it } from 'bun:test'
import { decodeJwt, SignJWT } from 'jose'
import {
  extractBearerToken,
  hashNodeToken,
  introspectToken,
  isActorId,
  mintActorToken,
  mintLocalToken,
  mintNodeToken,
  verifyActorToken,
  verifyIdentityV02Token,
  verifyLocalToken
} from '../../../packages/auth/src/index.ts'

const testSecret = 'test-secret-key-for-unit-tests'

function testSecretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

type MintActorOverrides = Partial<Parameters<typeof mintActorToken>[0]>

async function mintTestActorToken(overrides: MintActorOverrides = {}): Promise<string> {
  return mintActorToken({
    actor: 'viewer',
    secret: testSecret,
    jti: 'test-jti',
    issuedBy: 'admin',
    purpose: 'unit-test',
    ...overrides
  })
}

type CustomActorJwtInput = {
  secret?: string
  subject?: string
  audience?: string
  jti?: string
  issuedBy?: string
  purpose?: string
  includeJti?: boolean
  includeIssuedBy?: boolean
  includePurpose?: boolean
  includeDates?: boolean
}

async function signCustomActorJwt(input: CustomActorJwtInput = {}): Promise<string> {
  const issuedAtDate = new Date()
  const expiresAtDate = new Date(issuedAtDate.getTime() + 60_000)

  let token = new SignJWT({
    ...(input.includeDates === false
      ? {}
      : {
          issuedAt: issuedAtDate.toISOString(),
          expiresAt: expiresAtDate.toISOString()
        }),
    ...(input.includeIssuedBy === false ? {} : { issuedBy: input.issuedBy ?? 'admin' }),
    ...(input.includePurpose === false ? {} : { purpose: input.purpose ?? 'unit-test' })
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('meristem-local')
    .setAudience(input.audience ?? 'meristem-core')
    .setSubject(input.subject ?? 'viewer')

  if (input.includeDates !== false) {
    token = token
      .setIssuedAt(Math.floor(issuedAtDate.getTime() / 1_000))
      .setExpirationTime(Math.floor(expiresAtDate.getTime() / 1_000))
  }

  if (input.includeJti !== false) {
    token = token.setJti(input.jti ?? 'test-jti')
  }

  return token.sign(testSecretBytes(input.secret ?? testSecret))
}

describe('isActorId', () => {
  it('returns true for known actors', () => {
    expect(isActorId('viewer')).toBe(true)
    expect(isActorId('operator')).toBe(true)
    expect(isActorId('admin')).toBe(true)
    expect(isActorId('security-admin')).toBe(true)
    expect(isActorId('break-glass-reviewer')).toBe(true)
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
    expect(typeof (await mintLocalToken({ actor: 'break-glass-reviewer', secret: testSecret }))).toBe(
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

  it('honors 1h duration strings', async () => {
    const token = await mintTestActorToken({ expiresIn: '1h' })

    expect(token.split('.')).toHaveLength(3)
  })

  it('honors 30m duration strings', async () => {
    const token = await mintTestActorToken({ expiresIn: '30m' })

    expect(token.split('.')).toHaveLength(3)
  })

  it('honors 1d duration strings', async () => {
    const token = await mintTestActorToken({ expiresIn: '1d' })

    expect(token.split('.')).toHaveLength(3)
  })

  it('honors 500ms duration strings', async () => {
    const token = await mintTestActorToken({ expiresIn: '500ms' })

    expect(token.split('.')).toHaveLength(3)
  })

  it('supports every documented expiresIn unit format', async () => {
    for (const expiresIn of ['60', '500ms', '30s', '5m', '1h', '1d']) {
      const token = await mintTestActorToken({ expiresIn, jti: `jti-${expiresIn}` })
      expect(token.split('.')).toHaveLength(3)
    }
  })

  it('keeps ISO claims aligned with numeric JWT timestamps', async () => {
    const token = await mintTestActorToken({ expiresIn: '1500ms', jti: 'aligned-claims-jti' })
    const payload = decodeJwt(token)

    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')

    const verified = await verifyActorToken(token, testSecret)
    expect(verified.ok).toBe(true)

    if (!verified.ok || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
      throw new Error('expected aligned JWT timestamp claims')
    }

    expect(payload.iat).toBe(Math.floor(new Date(verified.issuedAt).getTime() / 1_000))
    expect(payload.exp).toBe(Math.floor(new Date(verified.expiresAt).getTime() / 1_000))
  })

  it('rejects unsupported expiresIn formats', async () => {
    let thrown: unknown

    try {
      await mintTestActorToken({ expiresIn: 'tomorrow' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)

    if (!(thrown instanceof Error)) {
      throw new Error('expected an expiresIn parsing error')
    }

    expect(thrown.message).toBe('Unsupported expiresIn format: tomorrow')
  })
})

describe('verifyActorToken', () => {
  it('verifies a minted actor token and returns its payload fields', async () => {
    const token = await mintTestActorToken({
      jti: 'verify-actor-jti',
      purpose: 'support-session'
    })
    const result = await verifyActorToken(token, testSecret)

    expect(result).toMatchObject({
      ok: true,
      actor: 'viewer',
      jti: 'verify-actor-jti',
      purpose: 'support-session',
      issuedBy: 'admin',
      audience: 'meristem-core',
      issuer: 'meristem-local'
    })

    if (!result.ok) {
      throw new Error('expected actor token verification to succeed')
    }

    expect(new Date(result.issuedAt).toISOString()).toBe(result.issuedAt)
    expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt)
  })

  it('falls back to numeric iat and exp claims when iso claims are absent', async () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1_000)
    const token = await new SignJWT({
      issuedBy: 'admin',
      purpose: 'numeric-fallback'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('meristem-local')
      .setAudience('meristem-core')
      .setSubject('viewer')
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(issuedAtSeconds + 60)
      .setJti('numeric-fallback-jti')
      .sign(testSecretBytes(testSecret))
    const result = await verifyActorToken(token, testSecret)

    expect(result).toMatchObject({
      ok: true,
      actor: 'viewer',
      jti: 'numeric-fallback-jti',
      purpose: 'numeric-fallback'
    })

    if (!result.ok) {
      throw new Error('expected numeric iat/exp fallback verification to succeed')
    }

    expect(result.issuedAt).toBe(new Date(issuedAtSeconds * 1_000).toISOString())
    expect(result.expiresAt).toBe(new Date((issuedAtSeconds + 60) * 1_000).toISOString())
  })

  it('returns invalid_token for the wrong secret', async () => {
    const token = await mintTestActorToken()

    await expect(verifyActorToken(token, 'wrong-secret')).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_token for tokens with an unknown actor subject', async () => {
    const token = await signCustomActorJwt({ subject: 'intruder' })

    await expect(verifyActorToken(token, testSecret)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_token when the jwt is missing jti', async () => {
    const token = await signCustomActorJwt({ includeJti: false })

    await expect(verifyActorToken(token, testSecret)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_token when issuedBy is not a known actor', async () => {
    const token = await signCustomActorJwt({ issuedBy: 'intruder' })

    await expect(verifyActorToken(token, testSecret)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_token when purpose is missing', async () => {
    const token = await signCustomActorJwt({ includePurpose: false })

    await expect(verifyActorToken(token, testSecret)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })

  it('returns invalid_token when issuedAt and expiresAt claims are missing', async () => {
    const token = await signCustomActorJwt({ includeDates: false })

    await expect(verifyActorToken(token, testSecret)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })
})

describe('verifyIdentityV02Token', () => {
  it('accepts a matching explicit audience', async () => {
    const token = await mintTestActorToken({
      audience: 'meristem-service',
      jti: 'service-audience-jti'
    })
    const result = await verifyIdentityV02Token({
      token,
      secret: testSecret,
      expectedAudience: 'meristem-service'
    })

    expect(result).toMatchObject({
      ok: true,
      actor: 'viewer',
      jti: 'service-audience-jti',
      audience: 'meristem-service'
    })
  })

  it('returns invalid_token for a mismatched explicit audience', async () => {
    const token = await mintTestActorToken({ audience: 'meristem-service' })

    await expect(
      verifyIdentityV02Token({
        token,
        secret: testSecret,
        expectedAudience: 'meristem-core'
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })
})

describe('introspectToken', () => {
  it('returns active when the token is valid and not revoked', async () => {
    const token = await mintTestActorToken({ jti: 'active-jti' })
    let checkedJti: string | null = null

    const result = await introspectToken({
      token,
      secret: testSecret,
      checkRevocation: async jti => {
        checkedJti = jti
        return false
      }
    })

    expect(checkedJti).toBe('active-jti')
    expect(result).toMatchObject({
      active: true,
      actor: 'viewer',
      jti: 'active-jti',
      status: 'active'
    })

    if (!result.active) {
      throw new Error('expected active token introspection result')
    }

    expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt)
  })

  it('returns revoked when revocation check reports the token as revoked', async () => {
    const token = await mintTestActorToken({ jti: 'revoked-jti' })

    await expect(
      introspectToken({
        token,
        secret: testSecret,
        checkRevocation: async () => true
      })
    ).resolves.toEqual({
      active: false,
      status: 'revoked'
    })
  })

  it('returns expired when the token lifetime has elapsed', async () => {
    const token = await mintTestActorToken({ expiresIn: '0s' })

    await Bun.sleep(1_100)

    await expect(
      introspectToken({
        token,
        secret: testSecret,
        checkRevocation: async () => false
      })
    ).resolves.toEqual({
      active: false,
      status: 'expired'
    })
  })

  it('returns inactive for invalid tokens without calling revocation checks', async () => {
    let checked = false

    const result = await introspectToken({
      token: 'not-a-token',
      secret: testSecret,
      checkRevocation: async () => {
        checked = true
        return false
      }
    })

    expect(result).toEqual({ active: false })
    expect(checked).toBe(false)
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
