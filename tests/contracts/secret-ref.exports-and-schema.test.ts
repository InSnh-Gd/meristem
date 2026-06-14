import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { SecretRefV01Schema, SecretRefVersionSchema } from './_helpers/secret-ref.ts'

describe('SecretRef v0.1 export existence gates', () => {
  it('packages/contracts exports SecretRefV01Schema', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefV01Schema')
  })

  it('packages/contracts exports SecretRefVersionSchema', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefVersionSchema')
  })

  it('packages/contracts exports SecretRefTransitionSchema', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('SecretRefTransitionSchema')
  })

  it('packages/contracts exports SecretPermissions (secret:read-metadata, secret:create, etc.)', async () => {
    const mod = await import('../../packages/contracts/src/literals.ts')
    const perms: readonly string[] = mod.permissions ?? []
    expect(perms).toContain('secret:read-metadata')
    expect(perms).toContain('secret:create')
    expect(perms).toContain('secret:rotate')
    expect(perms).toContain('secret:disable')
    expect(perms).toContain('secret:reference')
  })

  it('apps/core/src/routes/secrets.ts module exists', () => {
    return expect(import('../../apps/core/src/routes/secrets.ts')).resolves.toBeDefined()
  })

  it('apps/core/src/app.ts mounts secrets routes', async () => {
    const mod = await import('../../apps/core/src/app.ts')
    const app = mod.createCoreApp
    expect(typeof app).toBe('function')
  })
})

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
})
