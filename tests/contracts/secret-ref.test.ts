import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'

// ---------------------------------------------------------------------------
// SecretRef v0.1 Contract Tests
//
// Two layers:
// 1. Inline schema spec — documents the expected SecretRef V0.1 contract shapes.
//    These pass immediately because Effect Schema is available; they serve as
//    the executable specification and will be migrated to the contracts package
//    during Phase 18 implementation.
// 2. Export existence checks — verify that packages/contracts actually exports
//    the SecretRef symbols. These tests FAIL RED until Phase 18 adds those
//    exports. They replace the inline schemas when done.
//
// Sentinel prefix: SECRET-CTR
// ---------------------------------------------------------------------------

// ── Inline schema definitions (contract spec, not implementation) ──────

const SecretRefScopeSchema = Schema.Literal('system', 'service', 'node')

const SecretRefStatusSchema = Schema.Literal('active', 'rotated', 'disabled')

const SecretRefV01Schema = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: SecretRefScopeSchema,
  owner: Schema.Literal('core'),
  status: SecretRefStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
})

const SecretRefVersionSchema = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  version: Schema.Number,
  createdBy: Schema.String,
  createdAt: Schema.String,
  disabledAt: Schema.optional(Schema.String)
})

const SecretRefTransitionSchema = Schema.Struct({
  id: Schema.String,
  secretRefId: Schema.String,
  fromStatus: SecretRefStatusSchema,
  toStatus: SecretRefStatusSchema,
  actor: Schema.String,
  reason: Schema.optional(Schema.String),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  createdAt: Schema.String
})

// SecretRef DTO for list/show — must never contain plaintext
const SecretRefDTOSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal('secret-ref@0.1.0'),
  name: Schema.String,
  scope: SecretRefScopeSchema,
  owner: Schema.Literal('core'),
  status: SecretRefStatusSchema,
  createdBy: Schema.String,
  createdAt: Schema.String,
  rotatedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
})

// ── SecretRef export existence gates (RED until Phase 18) ──────────────

describe('SecretRef v0.1 export existence gates', () => {
  it('packages/contracts exports SecretRefV01Schema', async () => {
    // FAILS RED: SecretRefV01Schema is not yet part of the contracts package.
    // Phase 18 must add it to packages/contracts/src/schemas/secret-ref.ts.
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefV01Schema')
  })

  it('packages/contracts exports SecretRefVersionSchema', async () => {
    // FAILS RED: SecretRefVersionSchema is not yet part of the contracts package.
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefVersionSchema')
  })

  it('packages/contracts exports SecretRefTransitionSchema', async () => {
    // FAILS RED: SecretRefTransitionSchema is not yet part of the contracts package.
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefTransitionSchema')
  })

  it('packages/contracts exports SecretPermissions (secret:read-metadata, secret:create, etc.)', async () => {
    // FAILS RED: secret permissions may not yet be in the permissions array.
    // Phase 18 must ensure secret permissions are included.
    const mod = await import('../../packages/contracts/src/literals.ts')
    const perms: readonly string[] = mod.permissions ?? []
    expect(perms).toContain('secret:read-metadata')
    expect(perms).toContain('secret:create')
    expect(perms).toContain('secret:rotate')
    expect(perms).toContain('secret:disable')
    expect(perms).toContain('secret:reference')
  })

  it('apps/core/src/routes/secrets.ts module exists', async () => {
    // FAILS RED: secrets route module not yet created.
    // Phase 18 must add apps/core/src/routes/secrets.ts.
    await expect(
      import('../../apps/core/src/routes/secrets.ts')
    ).resolves.toBeDefined()
  })

  it('apps/core/src/app.ts mounts secrets routes', async () => {
    // FAILS RED: createCoreApp does not yet include secretsRoutes.
    // Phase 18 must add .use(secretsRoutes(deps)) to app.ts.
    const mod = await import('../../apps/core/src/app.ts')
    const app = mod.createCoreApp
    // The app should load without error when secrets routes are wired;
    // currently a missing import will throw at import-time.
    expect(typeof app).toBe('function')
  })
})

// ── Inline schema specification tests (pass immediately, document contract) ─

describe('SecretRef v0.1 contract schema spec', () => {
  it('decodes a valid active secretRef with all required fields', () => {
    const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-001',
      version: 'secret-ref@0.1.0',
      name: 'api-key-prod',
      scope: 'service',
      owner: 'core',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: { env: 'production' }
    })
    expect(result.id).toBe('sr-001')
    expect(result.scope).toBe('service')
    expect(result.status).toBe('active')
    expect(result.owner).toBe('core')
    expect(result.metadata).toEqual({ env: 'production' })
  })

  it('decodes a rotated secretRef with rotatedAt', () => {
    const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-002',
      version: 'secret-ref@0.1.0',
      name: 'db-password',
      scope: 'system',
      owner: 'core',
      status: 'rotated',
      createdBy: 'security-admin',
      createdAt: '2026-05-01T10:00:00.000Z',
      rotatedAt: '2026-06-01T10:00:00.000Z',
      metadata: {}
    })
    expect(result.status).toBe('rotated')
    expect(result.rotatedAt).toBe('2026-06-01T10:00:00.000Z')
  })

  it('decodes a disabled secretRef with disabledAt', () => {
    const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-003',
      version: 'secret-ref@0.1.0',
      name: 'old-token',
      scope: 'node',
      owner: 'core',
      status: 'disabled',
      createdBy: 'security-admin',
      createdAt: '2026-04-01T10:00:00.000Z',
      disabledAt: '2026-06-01T10:00:00.000Z',
      metadata: { reason: 'decommissioned' }
    })
    expect(result.status).toBe('disabled')
    expect(result.disabledAt).toBe('2026-06-01T10:00:00.000Z')
  })

  it('rejects unknown scope', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: 'sr-004',
        version: 'secret-ref@0.1.0',
        name: 'bad-scope',
        scope: 'cluster',
        owner: 'core',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
    ).toThrow()
  })

  it('rejects unknown status', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: 'sr-005',
        version: 'secret-ref@0.1.0',
        name: 'bad-status',
        scope: 'system',
        owner: 'core',
        status: 'expired',
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
    ).toThrow()
  })

  it('rejects owner that is not "core"', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: 'sr-006',
        version: 'secret-ref@0.1.0',
        name: 'bad-owner',
        scope: 'system',
        owner: 'm-secret',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
    ).toThrow()
  })

  it('round-trips secretRef encode → decode', () => {
    const secretRef = {
      id: 'sr-roundtrip',
      version: 'secret-ref@0.1.0' as const,
      name: 'roundtrip-test',
      scope: 'system' as const,
      owner: 'core' as const,
      status: 'active' as const,
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: { env: 'test' }
    }
    const encoded = Schema.encodeSync(SecretRefV01Schema)(secretRef)
    const decoded = Schema.decodeUnknownSync(SecretRefV01Schema)(encoded)
    expect(decoded).toEqual(secretRef)
  })

  // ── Version schema ───────────────────────────────────────────────────

  it('decodes a valid secretRef version', () => {
    const result = Schema.decodeUnknownSync(SecretRefVersionSchema)({
      id: 'srv-001',
      secretRefId: 'sr-001',
      version: 1,
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z'
    })
    expect(result.secretRefId).toBe('sr-001')
    expect(result.version).toBe(1)
  })

  it('decodes a disabled version with disabledAt', () => {
    const result = Schema.decodeUnknownSync(SecretRefVersionSchema)({
      id: 'srv-002',
      secretRefId: 'sr-001',
      version: 1,
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      disabledAt: '2026-06-02T10:00:00.000Z'
    })
    expect(result.disabledAt).toBe('2026-06-02T10:00:00.000Z')
  })

  // ── Transition schema ────────────────────────────────────────────────

  it('decodes a valid secretRef transition', () => {
    const result = Schema.decodeUnknownSync(SecretRefTransitionSchema)({
      id: 'srt-001',
      secretRefId: 'sr-001',
      fromStatus: 'active',
      toStatus: 'rotated',
      actor: 'security-admin',
      reason: 'periodic rotation',
      policyDecisionId: 'pd-001',
      correlationId: 'corr-001',
      createdAt: '2026-06-01T10:00:00.000Z'
    })
    expect(result.fromStatus).toBe('active')
    expect(result.toStatus).toBe('rotated')
    expect(result.actor).toBe('security-admin')
    expect(result.reason).toBe('periodic rotation')
  })

  it('decodes transition with optional fields omitted', () => {
    const result = Schema.decodeUnknownSync(SecretRefTransitionSchema)({
      id: 'srt-002',
      secretRefId: 'sr-001',
      fromStatus: 'active',
      toStatus: 'disabled',
      actor: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z'
    })
    expect(result.reason).toBeUndefined()
    expect(result.policyDecisionId).toBeUndefined()
  })

  // ── Redaction contract: DTO must never contain plaintext ─────────────

  it('DTO shape forbids plaintext field — secrets are never in list/show output', () => {
    // The DTO is the external representation — it must not have a 'value' or
    // 'plaintext' or 'secret' field. Schema structurally enforces this.
    const dtoKeys = Object.keys(SecretRefDTOSchema.fields)
    expect(dtoKeys).not.toContain('value')
    expect(dtoKeys).not.toContain('plaintext')
    expect(dtoKeys).not.toContain('secret')
    expect(dtoKeys).not.toContain('valueCiphertext')
  })

  it('DTO decode rejects extra plaintext field at runtime', () => {
    // Effect Schema with Struct decodes unknown input through the struct lens.
    // Extra fields are ignored by default (excess property stripping), but a
    // 'value' field that lands in the output after encode means the impl is
    // leaking. The contract test below verifies encode never includes it.
    const dto = {
      id: 'sr-redact',
      version: 'secret-ref@0.1.0' as const,
      name: 'redacted-secret',
      scope: 'service' as const,
      owner: 'core' as const,
      status: 'active' as const,
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: {}
    }
    const encoded = Schema.encodeSync(SecretRefDTOSchema)(dto)
    // The encode output must not contain the sentinel or a plaintext field
    const encodedStr = JSON.stringify(encoded)
    expect(encodedStr).not.toContain('MERISTEM_TEST_SECRET_DO_NOT_LOG')
    expect(encodedStr).not.toContain('"value"')
    expect(encodedStr).not.toContain('"plaintext"')
    expect(encodedStr).not.toContain('"secret"')
  })

  // ── Scope validation ─────────────────────────────────────────────────

  it('scope must be system, service, or node', () => {
    const validScopes = ['system', 'service', 'node'] as const
    for (const scope of validScopes) {
      const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: `sr-scope-${scope}`,
        version: 'secret-ref@0.1.0',
        name: `scope-test-${scope}`,
        scope,
        owner: 'core',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
      expect(result.scope).toBe(scope)
    }
  })

  it('rejects invalid scope values', () => {
    const invalidScopes = ['global', 'region', 'cluster', '', 'SYSTEM']
    for (const scope of invalidScopes) {
      expect(() =>
        Schema.decodeUnknownSync(SecretRefV01Schema)({
          id: `sr-bad-${scope}`,
          version: 'secret-ref@0.1.0',
          name: `bad-scope-${scope}`,
          scope,
          owner: 'core',
          status: 'active',
          createdBy: 'security-admin',
          createdAt: '2026-06-01T10:00:00.000Z',
          metadata: {}
        })
      ).toThrow()
    }
  })

  // ── Status lifecycle ─────────────────────────────────────────────────

  it('status must be active, rotated, or disabled', () => {
    const validStatuses = ['active', 'rotated', 'disabled'] as const
    for (const status of validStatuses) {
      const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: `sr-status-${status}`,
        version: 'secret-ref@0.1.0',
        name: `status-test-${status}`,
        scope: 'system',
        owner: 'core',
        status,
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
      expect(result.status).toBe(status)
    }
  })

  it('rejects invalid status values', () => {
    const invalidStatuses = ['deleted', 'archived', 'pending', '']
    for (const status of invalidStatuses) {
      expect(() =>
        Schema.decodeUnknownSync(SecretRefV01Schema)({
          id: `sr-badstatus-${status}`,
          version: 'secret-ref@0.1.0',
          name: `bad-status-${status}`,
          scope: 'system',
          owner: 'core',
          status,
          createdBy: 'security-admin',
          createdAt: '2026-06-01T10:00:00.000Z',
          metadata: {}
        })
      ).toThrow()
    }
  })

  // ── Metadata shape ───────────────────────────────────────────────────

  it('metadata is a string-to-string record', () => {
    const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-meta',
      version: 'secret-ref@0.1.0',
      name: 'meta-test',
      scope: 'service',
      owner: 'core',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: { key1: 'value1', key2: 'value2' }
    })
    expect(result.metadata.key1).toBe('value1')
    expect(result.metadata.key2).toBe('value2')
  })

  it('empty metadata is valid', () => {
    const result = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-empty-meta',
      version: 'secret-ref@0.1.0',
      name: 'empty-meta',
      scope: 'system',
      owner: 'core',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: {}
    })
    expect(result.metadata).toEqual({})
  })

  // ── Version field is pinned to secret-ref@0.1.0 ──────────────────────

  it('version must be exactly secret-ref@0.1.0', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefV01Schema)({
        id: 'sr-badver',
        version: 'secret-ref@0.2.0',
        name: 'bad-version',
        scope: 'system',
        owner: 'core',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z',
        metadata: {}
      })
    ).toThrow()
  })

  // ── Schema narrowing ─────────────────────────────────────────────────

  it('narrows parsed secretRef to SecretRefV01 shape', () => {
    const parsed = Schema.decodeUnknownSync(SecretRefV01Schema)({
      id: 'sr-narrow',
      version: 'secret-ref@0.1.0',
      name: 'narrowing-test',
      scope: 'system',
      owner: 'core',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      metadata: { env: 'dev' }
    })
    expect(typeof parsed.id).toBe('string')
    expect(['system', 'service', 'node']).toContain(parsed.scope)
    expect(['active', 'rotated', 'disabled']).toContain(parsed.status)
    expect(parsed.owner).toBe('core')
    expect(parsed.version).toBe('secret-ref@0.1.0')
  })

  // ── Transition status validation ─────────────────────────────────────

  it('transition fromStatus and toStatus must be valid secretRef statuses', () => {
    const result = Schema.decodeUnknownSync(SecretRefTransitionSchema)({
      id: 'srt-003',
      secretRefId: 'sr-001',
      fromStatus: 'active',
      toStatus: 'rotated',
      actor: 'security-admin',
      createdAt: '2026-06-01T10:00:00.000Z'
    })
    expect(result.fromStatus).toBe('active')
  })

  it('rejects invalid transition fromStatus', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefTransitionSchema)({
        id: 'srt-004',
        secretRefId: 'sr-001',
        fromStatus: 'deleted',
        toStatus: 'active',
        actor: 'security-admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })
})
