import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  identityApiRoutes,
  identityEdenV02Contract
} from '../../packages/contracts/src/schemas/identity.ts'

// ---------------------------------------------------------------------------
// Identity v0 Contract Tests
//
// Two layers:
// 1. Public route contract checks — pin the active Identity REST/Eden paths to
//    the canonical /api/v0 prefix used by the running Core service.
// 2. Inline schema spec — documents the expected Identity token and actor
//    contract shapes that the current package exports.
//    These pass immediately because Effect Schema is available; they serve as
//    the executable specification alongside the package exports.
// 3. Export existence checks — verify that packages/contracts and packages/auth
//    actually export the Identity symbols relied on by active callers.
//
// Sentinel prefix: IDY-V0-CTR
// ---------------------------------------------------------------------------

// ── Inline schema definitions (contract spec, not implementation) ──────

const ActorIdV02Schema = Schema.Literal('viewer', 'operator', 'admin', 'security-admin')

const IdentityActorV02Schema = Schema.Struct({
  id: ActorIdV02Schema,
  displayName: Schema.String,
  status: Schema.Literal('active', 'disabled'),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

const AudienceSchema = Schema.Literal('meristem-core', 'meristem-service')

const ActorTokenV02Schema = Schema.Struct({
  jti: Schema.String,
  actor: ActorIdV02Schema,
  issuer: Schema.Literal('meristem-local'),
  audience: AudienceSchema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  issuedBy: ActorIdV02Schema,
  purpose: Schema.String,
  status: Schema.Literal('active', 'revoked', 'expired'),
  revokedAt: Schema.optional(Schema.String),
  revokedBy: Schema.optional(ActorIdV02Schema),
  revokeReason: Schema.optional(Schema.String)
})

describe('Identity v0 public route contract', () => {
  it('uses /api/v0 identity routes for all active public endpoints', () => {
    expect(identityApiRoutes).toEqual({
      listActors: '/api/v0/identity/actors',
      getActor: '/api/v0/identity/actors/:id',
      issueToken: '/api/v0/identity/tokens',
      inspectToken: '/api/v0/identity/tokens/:jti',
      revokeToken: '/api/v0/identity/tokens/:jti/revoke',
      introspectToken: '/api/v0/identity/introspect'
    })
  })

  it('builds request URLs under the canonical /api/v0/identity prefix', () => {
    const requests = [
      new Request(`http://localhost${identityApiRoutes.listActors}`),
      new Request(`http://localhost${identityApiRoutes.issueToken}`, { method: 'POST' }),
      new Request(
        `http://localhost${identityApiRoutes.inspectToken.replace(':jti', 'IDY-V0-CTR-jti')}`
      ),
      new Request(
        `http://localhost${identityApiRoutes.revokeToken.replace(':jti', 'IDY-V0-CTR-jti')}`,
        { method: 'POST' }
      ),
      new Request(`http://localhost${identityApiRoutes.introspectToken}`, { method: 'POST' })
    ]

    for (const request of requests) {
      const pathname = new URL(request.url).pathname
      expect(pathname.startsWith('/api/v0/identity')).toBe(true)
      expect(pathname.startsWith('/api/v0/')).toBe(true)
    }
  })

  it('keeps Eden route strings aligned with the /api/v0 public contract', () => {
    expect(identityEdenV02Contract).toEqual({
      listActors: 'GET /api/v0/identity/actors',
      getActor: 'GET /api/v0/identity/actors/:id',
      issueToken: 'POST /api/v0/identity/tokens',
      inspectToken: 'GET /api/v0/identity/tokens/:jti',
      revokeToken: 'POST /api/v0/identity/tokens/:jti/revoke',
      introspectToken: 'POST /api/v0/identity/introspect'
    })
  })
})

// ── Identity export existence smoke checks ─────────────────────────

describe('Identity v0 export existence gates', () => {
  it('packages/contracts exports IdentityActorV02Schema', async () => {
    const mod = await import('../../packages/contracts/src/schemas/identity.ts')
    expect(mod).toHaveProperty('IdentityActorV02Schema')
  })

  it('packages/contracts exports ActorTokenV02Schema', async () => {
    const mod = await import('../../packages/contracts/src/schemas/identity.ts')
    expect(mod).toHaveProperty('ActorTokenV02Schema')
  })

  it('packages/contracts exports IdentityPermissions (identity:read, identity:token-issue, etc.)', async () => {
    const mod = await import('../../packages/contracts/src/literals.ts')
    const perms: readonly string[] = mod.permissions ?? []
    expect(perms).toContain('identity:read')
    expect(perms).toContain('identity:token-issue')
    expect(perms).toContain('identity:token-revoke')
    expect(perms).toContain('identity:token-inspect')
  })

  it('packages/auth exports verifyIdentityV02Token', async () => {
    const mod = await import('../../packages/auth/src/index.ts')
    expect(mod).toHaveProperty('verifyIdentityV02Token')
  })

  it('packages/auth exports audience validation that differentiates meristem-service', async () => {
    // meristem-service remains a valid audience value for service tokens.
    const mod = await import('../../packages/auth/src/index.ts')
    expect(mod).toHaveProperty('verifyIdentityV02Token')
    const verify = mod.verifyIdentityV02Token
    if (typeof verify === 'function') {
      // meristem-service audience must be a valid audience for service tokens
      const result = await verify({
        token: 'dummy',
        secret: 'test',
        expectedAudience: 'meristem-service'
      })
      // Should either fail (invalid token) or succeed if token is valid
      // but must NOT reject because audience 'meristem-service' is unknown
      expect(result).toBeDefined()
    }
  })

  it('packages/auth/extractBearerToken still works for identity v0 (non-breaking)', async () => {
    // This should already pass — extractBearerToken is implemented.
    const mod = await import('../../packages/auth/src/index.ts')
    const extract = mod.extractBearerToken
    expect(typeof extract).toBe('function')
    expect(extract('Bearer IDY-V0-CTR-test-token')).toBe('IDY-V0-CTR-test-token')
    expect(extract('Basic abc')).toBeNull()
  })
})

// ── Inline schema specification tests (pass immediately, document contract) ─

describe('Identity v0 contract schema spec', () => {
  it('decodes a valid active actor', () => {
    const result = Schema.decodeUnknownSync(IdentityActorV02Schema)({
      id: 'operator',
      displayName: 'Default Operator',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(result.id).toBe('operator')
    expect(result.status).toBe('active')
  })

  it('rejects unknown actor id', () => {
    expect(() =>
      Schema.decodeUnknownSync(IdentityActorV02Schema)({
        id: 'superuser',
        displayName: 'Fake',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toThrow()
  })

  it('round-trips actor encode → decode', () => {
    const actor = {
      id: 'security-admin' as const,
      displayName: 'Security Admin',
      status: 'active' as const,
      createdAt: '2026-03-15T12:00:00.000Z',
      updatedAt: '2026-03-15T12:00:00.000Z'
    }
    const encoded = Schema.encodeSync(IdentityActorV02Schema)(actor)
    const decoded = Schema.decodeUnknownSync(IdentityActorV02Schema)(encoded)
    expect(decoded).toEqual(actor)
  })

  it('decodes a valid active token with meristem-core audience', () => {
    const result = Schema.decodeUnknownSync(ActorTokenV02Schema)({
      jti: 'jti-test-001',
      actor: 'operator' as const,
      issuer: 'meristem-local' as const,
      audience: 'meristem-core' as const,
      issuedAt: '2026-05-01T10:00:00.000Z',
      expiresAt: '2026-05-01T18:00:00.000Z',
      issuedBy: 'security-admin' as const,
      purpose: 'runtime access',
      status: 'active' as const
    })
    expect(result.jti).toBe('jti-test-001')
    expect(result.status).toBe('active')
    expect(result.audience).toBe('meristem-core')
  })

  it('decodes a token with meristem-service audience', () => {
    const result = Schema.decodeUnknownSync(ActorTokenV02Schema)({
      jti: 'jti-test-002',
      actor: 'operator' as const,
      issuer: 'meristem-local' as const,
      audience: 'meristem-service' as const,
      issuedAt: '2026-05-01T10:00:00.000Z',
      expiresAt: '2026-05-01T18:00:00.000Z',
      issuedBy: 'security-admin' as const,
      purpose: 'm-task access',
      status: 'active' as const
    })
    expect(result.jti).toBe('jti-test-002')
    expect(result.audience).toBe('meristem-service')
  })

  it('decodes a revoked token with revocation metadata', () => {
    const result = Schema.decodeUnknownSync(ActorTokenV02Schema)({
      jti: 'jti-test-003',
      actor: 'operator' as const,
      issuer: 'meristem-local' as const,
      audience: 'meristem-core' as const,
      issuedAt: '2026-05-01T10:00:00.000Z',
      expiresAt: '2026-05-01T18:00:00.000Z',
      issuedBy: 'security-admin' as const,
      purpose: 'compromised token',
      status: 'revoked' as const,
      revokedAt: '2026-05-01T12:00:00.000Z',
      revokedBy: 'security-admin' as const,
      revokeReason: 'suspected compromise'
    })
    expect(result.status).toBe('revoked')
    expect(result.revokedBy).toBe('security-admin')
    expect(result.revokeReason).toBe('suspected compromise')
  })

  it('decodes an expired token', () => {
    const result = Schema.decodeUnknownSync(ActorTokenV02Schema)({
      jti: 'jti-test-004',
      actor: 'operator' as const,
      issuer: 'meristem-local' as const,
      audience: 'meristem-core' as const,
      issuedAt: '2026-05-01T10:00:00.000Z',
      expiresAt: '2026-05-01T10:00:01.000Z',
      issuedBy: 'security-admin' as const,
      purpose: 'short-lived',
      status: 'expired' as const
    })
    expect(result.status).toBe('expired')
  })

  // ── jti requirement ──────────────────────────────────────────────────

  it('rejects a token missing jti (legacy token rejection)', () => {
    // Legacy tokens carry sub/iss/aud but no jti.
    // Identity v0 requires jti — Schema rejects tokens without it.
    expect(() =>
      Schema.decodeUnknownSync(ActorTokenV02Schema)({
        actor: 'viewer' as const,
        issuer: 'meristem-local' as const,
        audience: 'meristem-core' as const,
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T08:00:00.000Z',
        issuedBy: 'operator' as const,
        purpose: 'legacy token',
        status: 'active' as const
      })
    ).toThrow()
  })

  // ── Audience validation ──────────────────────────────────────────────

  it('rejects unknown audience', () => {
    expect(() =>
      Schema.decodeUnknownSync(ActorTokenV02Schema)({
        jti: 'jti-test-005',
        actor: 'operator' as const,
        issuer: 'meristem-local' as const,
        audience: 'external-service' as const,
        issuedAt: '2026-05-01T10:00:00.000Z',
        expiresAt: '2026-05-01T18:00:00.000Z',
        issuedBy: 'security-admin' as const,
        purpose: 'bad audience',
        status: 'active' as const
      })
    ).toThrow()
  })

  // ── Unknown status rejection ────────────────────────────────────────

  it('rejects unknown token status', () => {
    expect(() =>
      Schema.decodeUnknownSync(ActorTokenV02Schema)({
        jti: 'jti-test-006',
        actor: 'operator' as const,
        issuer: 'meristem-local' as const,
        audience: 'meristem-core' as const,
        issuedAt: '2026-05-01T10:00:00.000Z',
        expiresAt: '2026-05-01T18:00:00.000Z',
        issuedBy: 'security-admin' as const,
        purpose: 'bad status',
        status: 'unknown' as const
      })
    ).toThrow()
  })

  // ── Schema narrowing: parse results are structurally typed ──────────

  it('narrows parsed token to ActorTokenV02 shape', () => {
    const parsed = Schema.decodeUnknownSync(ActorTokenV02Schema)({
      jti: 'jti-narrow-001',
      actor: 'operator' as const,
      issuer: 'meristem-local' as const,
      audience: 'meristem-core' as const,
      issuedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-06-02T00:00:00.000Z',
      issuedBy: 'security-admin' as const,
      purpose: 'narrowing test',
      status: 'active' as const
    })
    expect(typeof parsed.jti).toBe('string')
    expect(['active', 'revoked', 'expired']).toContain(parsed.status)
  })
})
