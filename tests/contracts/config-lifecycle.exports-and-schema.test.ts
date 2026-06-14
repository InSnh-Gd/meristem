import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { ConfigApplyAckV01Schema, ConfigRecordV01Schema } from './_helpers/config-lifecycle.ts'

describe('Config Lifecycle export existence gates', () => {
  it('packages/contracts exports ConfigRecordV01Schema', async () => {
    const mod = await import('../../packages/contracts/src/schemas/config.ts')
    expect(mod).toHaveProperty('ConfigRecordV01Schema')
  })

  it('packages/contracts exports config permissions in literals', async () => {
    const mod = await import('../../packages/contracts/src/literals.ts')
    const perms: readonly string[] = mod.permissions ?? []
    expect(perms).toContain('config:read')
    expect(perms).toContain('config:draft')
    expect(perms).toContain('config:validate')
    expect(perms).toContain('config:publish')
    expect(perms).toContain('config:rollback')
  })

  it('packages/contracts/src/schemas/config.ts module exists', async () => {
    const mod = await import('../../packages/contracts/src/schemas/config.ts')
    expect(mod).toBeDefined()
  })
})

describe('Config v0.1 package root export', () => {
  it('exports ConfigRecordV01Schema from packages/contracts', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('ConfigRecordV01Schema')
  })

  it('exports ConfigVersionV01Schema from packages/contracts', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('ConfigVersionV01Schema')
  })

  it('exports ConfigTransitionV01Schema from packages/contracts', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('ConfigTransitionV01Schema')
  })

  it('exports ConfigApplyAckV01Schema from packages/contracts', async () => {
    const mod = await import('../../packages/contracts/src/index.ts')
    expect(mod).toHaveProperty('ConfigApplyAckV01Schema')
  })
})

describe('Config v0.1 contract schema spec', () => {
  it('decodes a valid draft config record', () => {
    const record = {
      id: 'cfg-001',
      configVersion: '1.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'abc123def456',
      domain: 'core' as const,
      targetScope: ['m-net', 'm-policy'],
      status: 'draft' as const,
      createdBy: 'admin',
      createdAt: '2026-06-01T10:00:00.000Z'
    }

    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(record)
    expect(decoded.id).toBe('cfg-001')
    expect(decoded.status).toBe('draft')
    expect(decoded.domain).toBe('core')
    expect(decoded.targetScope).toEqual(['m-net', 'm-policy'])
  })

  it('decodes a published config with optional fields', () => {
    const record = {
      id: 'cfg-002',
      configVersion: '2.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'xyz789',
      domain: 'm-net' as const,
      targetScope: ['m-network-1'],
      status: 'published' as const,
      createdBy: 'admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      publishedBy: 'security-admin',
      publishedAt: '2026-06-01T11:00:00.000Z'
    }

    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(record)
    expect(decoded.status).toBe('published')
    expect(decoded.publishedBy).toBe('security-admin')
    expect(decoded.publishedAt).toBe('2026-06-01T11:00:00.000Z')
  })

  it('decodes a rolled_back config with rollbackVersion', () => {
    const record = {
      id: 'cfg-003',
      configVersion: '3.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'rollback-hash',
      domain: 'm-policy' as const,
      targetScope: ['m-policy'],
      status: 'rolled_back' as const,
      createdBy: 'admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      publishedBy: 'security-admin',
      publishedAt: '2026-06-01T11:00:00.000Z',
      rollbackVersion: '2.0.0'
    }

    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(record)
    expect(decoded.status).toBe('rolled_back')
    expect(decoded.rollbackVersion).toBe('2.0.0')
  })

  it('decodes an applied config (after domain ack)', () => {
    const record = {
      id: 'cfg-004',
      configVersion: '1.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'applied-hash',
      domain: 'm-extension' as const,
      targetScope: ['m-extension'],
      status: 'applied' as const,
      createdBy: 'admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      publishedBy: 'security-admin',
      publishedAt: '2026-06-01T10:05:00.000Z'
    }

    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(record)
    expect(decoded.status).toBe('applied')
    expect(decoded.domain).toBe('m-extension')
  })

  it('decodes a failed config', () => {
    const record = {
      id: 'cfg-005',
      configVersion: '1.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'failed-hash',
      domain: 'm-ui' as const,
      targetScope: ['m-ui-bff'],
      status: 'failed' as const,
      createdBy: 'admin',
      createdAt: '2026-06-01T10:00:00.000Z',
      publishedBy: 'security-admin',
      publishedAt: '2026-06-01T10:05:00.000Z'
    }

    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(record)
    expect(decoded.status).toBe('failed')
  })

  it('round-trips config record encode → decode', () => {
    const record = {
      id: 'cfg-round-001',
      configVersion: '1.0.0',
      schemaVersion: 'config@0.1.0',
      configHash: 'round-hash',
      domain: 'core' as const,
      targetScope: ['meristem-core'],
      status: 'validated' as const,
      createdBy: 'admin',
      createdAt: '2026-06-02T12:00:00.000Z'
    }
    const encoded = Schema.encodeSync(ConfigRecordV01Schema)(record)
    const decoded = Schema.decodeUnknownSync(ConfigRecordV01Schema)(encoded)
    expect(decoded).toEqual(record)
  })

  it('rejects unknown config domain', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-bad-001',
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        domain: 'external-platform',
        targetScope: [],
        status: 'draft',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects unknown config status', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-bad-002',
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        domain: 'core' as const,
        targetScope: [],
        status: 'reviewing',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects config record missing id', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        domain: 'core',
        targetScope: [],
        status: 'draft',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects config record missing configVersion', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-missing-ver',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        domain: 'core',
        targetScope: [],
        status: 'draft',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects config record missing configHash', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-missing-hash',
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        domain: 'core',
        targetScope: [],
        status: 'draft',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects config record missing domain', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-missing-domain',
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        targetScope: [],
        status: 'draft',
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('rejects config record missing status', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigRecordV01Schema)({
        id: 'cfg-missing-status',
        configVersion: '1.0.0',
        schemaVersion: 'config@0.1.0',
        configHash: 'bad-hash',
        domain: 'core',
        targetScope: [],
        createdBy: 'admin',
        createdAt: '2026-06-01T10:00:00.000Z'
      })
    ).toThrow()
  })

  it('decodes a valid apply ack', () => {
    const ack = {
      ackId: 'ack-001',
      configId: 'cfg-001',
      configVersion: '1.0.0',
      ackedBy: 'm-net',
      ackedAt: '2026-06-01T11:00:00.000Z',
      status: 'acked' as const
    }

    const decoded = Schema.decodeUnknownSync(ConfigApplyAckV01Schema)(ack)
    expect(decoded.ackId).toBe('ack-001')
    expect(decoded.status).toBe('acked')
  })

  it('decodes a failed apply ack with error detail', () => {
    const ack = {
      ackId: 'ack-002',
      configId: 'cfg-001',
      configVersion: '1.0.0',
      ackedBy: 'm-net',
      ackedAt: '2026-06-01T11:00:00.000Z',
      status: 'failed' as const,
      errorCode: 'm-net.apply.timeout',
      errorMessage: 'M-Net could not apply config within window'
    }

    const decoded = Schema.decodeUnknownSync(ConfigApplyAckV01Schema)(ack)
    expect(decoded.status).toBe('failed')
    expect(decoded.errorCode).toBe('m-net.apply.timeout')
    expect(decoded.errorMessage).toBe('M-Net could not apply config within window')
  })

  it('rejects ack with unknown status', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigApplyAckV01Schema)({
        ackId: 'ack-bad',
        configId: 'cfg-001',
        configVersion: '1.0.0',
        ackedBy: 'm-net',
        ackedAt: '2026-06-01T11:00:00.000Z',
        status: 'pending'
      })
    ).toThrow()
  })
})
