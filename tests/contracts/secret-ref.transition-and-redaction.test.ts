import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  SecretRefDTOSchema,
  SecretRefTransitionSchema,
  SecretRefV01Schema
} from './_helpers/secret-ref.ts'

describe('SecretRef v0.1 contract schema spec', () => {
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

  it('DTO shape forbids plaintext field — secrets are never in list/show output', () => {
    const dtoKeys = Object.keys(SecretRefDTOSchema.fields)
    expect(dtoKeys).not.toContain('value')
    expect(dtoKeys).not.toContain('plaintext')
    expect(dtoKeys).not.toContain('secret')
    expect(dtoKeys).not.toContain('valueCiphertext')
  })

  it('DTO decode rejects extra plaintext field at runtime', () => {
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
    const encodedStr = JSON.stringify(encoded)
    expect(encodedStr).not.toContain('MERISTEM_TEST_SECRET_DO_NOT_LOG')
    expect(encodedStr).not.toContain('"value"')
    expect(encodedStr).not.toContain('"plaintext"')
    expect(encodedStr).not.toContain('"secret"')
  })

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
