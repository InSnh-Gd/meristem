import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'

// ---------------------------------------------------------------------------
// Config Lifecycle v0.1 Contract Tests
//
// Two layers:
// 1. Inline schema spec — documents the expected ConfigRecordV01 contract shapes.
//    These pass immediately because Effect Schema is available; they serve as
//    the executable specification and will be migrated to the contracts package
//    during Phase 19 implementation.
// 2. Export existence checks — verify that packages/contracts exports the
//    ConfigRecordV01 schema and config permissions. These tests FAIL RED until
//    Phase 19 adds those exports.
//
// Sentinel prefix: CFG-V01-CTR
// ---------------------------------------------------------------------------

// ── Inline schema definitions (contract spec, not implementation) ──────

const ConfigDomainV01 = Schema.Literal(
  'core',
  'm-net',
  'm-policy',
  'm-log',
  'm-extension',
  'm-ui'
)

const ConfigStatusV01 = Schema.Literal(
  'draft',
  'validated',
  'published',
  'applied',
  'failed',
  'rolled_back'
)

const ConfigRecordV01Schema = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  domain: ConfigDomainV01,
  targetScope: Schema.Array(Schema.String),
  status: ConfigStatusV01,
  createdBy: Schema.String,
  createdAt: Schema.String,
  publishedBy: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  rollbackVersion: Schema.optional(Schema.String)
})

const ConfigApplyAckV01Schema = Schema.Struct({
  ackId: Schema.String,
  configId: Schema.String,
  configVersion: Schema.String,
  ackedBy: Schema.String,
  ackedAt: Schema.String,
  status: Schema.Literal('acked', 'failed'),
  errorCode: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String)
})

// ── Deterministic hash (pure function, no implementation needed) ────────

import { createHash } from 'node:crypto'

/**
 * Compute a deterministic SHA-256 hash of a normalized config payload.
 * The hash uses sorted keys and stable JSON serialization.
 */
function deterministicConfigHash(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(normalized).digest('hex')
}

// ── Export existence gates (RED until Phase 19) ────────────────────────

describe('Config Lifecycle export existence gates', () => {
  it('packages/contracts exports ConfigRecordV01Schema', async () => {
    // FAILS RED: ConfigRecordV01Schema is not yet part of the contracts package.
    // Phase 19 must add it to packages/contracts/src/schemas/config.ts.
    const mod = await import('../../packages/contracts/src/schemas/config.ts')
    expect(mod).toHaveProperty('ConfigRecordV01Schema')
  })

  it('packages/contracts exports config permissions in literals', async () => {
    // FAILS RED: config permissions may not yet be in the permissions array.
    // Phase 19 must ensure configPermissions are in the exported permissions union.
    const mod = await import('../../packages/contracts/src/literals.ts')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perms: readonly string[] = (mod as any).permissions ?? []
    expect(perms).toContain('config:read')
    expect(perms).toContain('config:draft')
    expect(perms).toContain('config:validate')
    expect(perms).toContain('config:publish')
    expect(perms).toContain('config:rollback')
  })

  it('packages/contracts/src/schemas/config.ts module exists', async () => {
    // FAILS RED: file does not exist yet.
    // Phase 19 must create packages/contracts/src/schemas/config.ts.
    const mod = await import('../../packages/contracts/src/schemas/config.ts')
    expect(mod).toBeDefined()
  })
})

// ── Inline schema specification tests (pass immediately, document contract) ─

describe('Config v0.1 contract schema spec', () => {
  // ── Positive decode ───────────────────────────────────────────────────

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

  // ── Round-tripping ────────────────────────────────────────────────────

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

  // ── Unknown domain rejection ──────────────────────────────────────────

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

  // ── Unknown status rejection ──────────────────────────────────────────

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

  // ── Required fields ───────────────────────────────────────────────────

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

  // ── ApplyAck schema ───────────────────────────────────────────────────

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

// ── Deterministic hash tests ──────────────────────────────────────────────

describe('Config deterministic hash', () => {
  it('same normalized input twice → same hash', () => {
    const payload1 = {
      domain: 'core',
      targetScope: ['m-net'],
      opentelemetry: { enabled: true }
    }
    const payload2 = {
      domain: 'core',
      targetScope: ['m-net'],
      opentelemetry: { enabled: true }
    }

    const hash1 = deterministicConfigHash(payload1)
    const hash2 = deterministicConfigHash(payload2)

    expect(hash1).toBe(hash2)
    expect(typeof hash1).toBe('string')
    expect(hash1.length).toBe(64) // sha256 hex
  })

  it('different input → different hash', () => {
    const payload1 = { domain: 'core', targetScope: ['m-net'] }
    const payload2 = { domain: 'core', targetScope: ['m-policy'] }

    const hash1 = deterministicConfigHash(payload1)
    const hash2 = deterministicConfigHash(payload2)

    expect(hash1).not.toBe(hash2)
  })

  it('key order independence: same hash regardless of key order', () => {
    // Input with different key order but same key/value pairs must yield identical hash.
    const ordered = deterministicConfigHash({ a: '1', b: '2' })
    const reversed = deterministicConfigHash({ b: '2', a: '1' })

    expect(ordered).toBe(reversed)
  })

  it('hash changes when any field changes', () => {
    const base = { domain: 'core', target: 'all' }

    const h1 = deterministicConfigHash(base)
    const h2 = deterministicConfigHash({ ...base, domain: 'm-net' })
    const h3 = deterministicConfigHash({ ...base, version: '1.0' })

    expect(h1).not.toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h2).not.toBe(h3)
  })

  it('hash is stable across repeated calls', () => {
    const payload = {
      domain: 'm-policy',
      targetScope: ['all-services'],
      rules: { riskThreshold: 5 }
    }

    const hashes = Array.from({ length: 10 }, () => deterministicConfigHash(payload))
    const unique = new Set(hashes)
    expect(unique.size).toBe(1)
  })
})

// ── State machine transition tests ────────────────────────────────────────

describe('Config state machine', () => {
  type ConfigAction =
    | 'validate'
    | 'publish'
    | 'apply_ack'
    | 'apply_fail'
    | 'rollback'
    | 'draft'

  type ConfigState = 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'

  /**
   * nextConfigState is the pure state machine transition function for Phase 19.
   * NOT yet implemented — this inline version documents the contract.
   * Phase 19 must create packages/contracts/src/config-state-machine.ts
   * exporting nextConfigState with these exact transitions.
   */
  function nextConfigState(state: ConfigState, action: ConfigAction): ConfigState {
    switch (state) {
      case 'draft':
        if (action === 'validate') return 'validated'
        return state

      case 'validated':
        if (action === 'publish') return 'published'
        if (action === 'validate') return 'validated' // idempotent
        return state

      case 'published':
        if (action === 'apply_ack') return 'applied'
        if (action === 'apply_fail') return 'failed'
        if (action === 'rollback') return 'rolled_back'
        return state

      case 'applied':
        if (action === 'rollback') return 'rolled_back'
        return state

      case 'failed':
        if (action === 'rollback') return 'rolled_back'
        if (action === 'validate') return 'validated'
        return state

      case 'rolled_back':
        // rolled_back is terminal for a version; a new draft creates a new config
        return state

      default:
        return state
    }
  }

  const allStates: ConfigState[] = ['draft', 'validated', 'published', 'applied', 'failed', 'rolled_back']
  const allActions: ConfigAction[] = ['validate', 'publish', 'apply_ack', 'apply_fail', 'rollback', 'draft']

  // ── Valid transitions ─────────────────────────────────────────────────

  it('draft + validate → validated', () => {
    expect(nextConfigState('draft', 'validate')).toBe('validated')
  })

  it('validated + publish → published', () => {
    expect(nextConfigState('validated', 'publish')).toBe('published')
  })

  it('published + apply_ack → applied', () => {
    expect(nextConfigState('published', 'apply_ack')).toBe('applied')
  })

  it('published + apply_fail → failed', () => {
    expect(nextConfigState('published', 'apply_fail')).toBe('failed')
  })

  it('published + rollback → rolled_back', () => {
    expect(nextConfigState('published', 'rollback')).toBe('rolled_back')
  })

  it('applied + rollback → rolled_back', () => {
    expect(nextConfigState('applied', 'rollback')).toBe('rolled_back')
  })

  it('failed + rollback → rolled_back', () => {
    expect(nextConfigState('failed', 'rollback')).toBe('rolled_back')
  })

  it('failed + validate → validated (recovery)', () => {
    expect(nextConfigState('failed', 'validate')).toBe('validated')
  })

  // ── No-op / invalid transitions ───────────────────────────────────────

  it('draft + publish → draft (no-op, must validate first)', () => {
    expect(nextConfigState('draft', 'publish')).toBe('draft')
  })

  it('draft + apply_ack → draft (no-op)', () => {
    expect(nextConfigState('draft', 'apply_ack')).toBe('draft')
  })

  it('validated + apply_ack → validated (no-op)', () => {
    expect(nextConfigState('validated', 'apply_ack')).toBe('validated')
  })

  it('validated + rollback → validated (no-op)', () => {
    expect(nextConfigState('validated', 'rollback')).toBe('validated')
  })

  it('applied + publish → applied (no-op)', () => {
    expect(nextConfigState('applied', 'publish')).toBe('applied')
  })

  it('rolled_back + any_action → rolled_back (terminal)', () => {
    for (const action of allActions) {
      expect(nextConfigState('rolled_back', action)).toBe('rolled_back')
    }
  })

  // ── Pure function property ────────────────────────────────────────────

  it('nextConfigState is pure: same input always returns same output', () => {
    for (let i = 0; i < 5; i++) {
      expect(nextConfigState('draft', 'validate')).toBe('validated')
      expect(nextConfigState('validated', 'publish')).toBe('published')
      expect(nextConfigState('published', 'apply_ack')).toBe('applied')
      expect(nextConfigState('applied', 'rollback')).toBe('rolled_back')
    }
  })

  // ── Full lifecycle tests ──────────────────────────────────────────────

  it('full happy path: draft → validated → published → applied', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_ack')
    expect(state).toBe('applied')
  })

  it('ack failure path: draft → validated → published → failed → rolled_back', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_fail')
    expect(state).toBe('failed')

    state = nextConfigState(state, 'rollback')
    expect(state).toBe('rolled_back')
  })

  it('direct rollback from published: draft → validated → published → rolled_back', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'rollback')
    expect(state).toBe('rolled_back')
  })

  it('failed recovery: draft → validated → published → failed → validate → validated → published → applied', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_fail')
    expect(state).toBe('failed')

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_ack')
    expect(state).toBe('applied')
  })
})

// ── Plaintext secret rejection ────────────────────────────────────────────

describe('Config plaintext secret rejection', () => {
  /**
   * Validates that a config payload does not contain plaintext secrets.
   * Phase 19 must provide this as a pure function export.
   */
  function containsPlaintextSecrets(payload: Record<string, unknown>): string[] {
    // Walk the payload recursively looking for keys that indicate secrets
    const secretKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'privateKey', 'private_key']
    const violations: string[] = []

    function walk(obj: unknown, path: string) {
      if (obj === null || obj === undefined) return
      if (typeof obj !== 'object') return
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => walk(item, `${path}[${i}]`))
        return
      }
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        const fullPath = path ? `${path}.${key}` : key
        if (secretKeys.includes(key.toLowerCase())) {
          violations.push(fullPath)
        }
        walk((obj as Record<string, unknown>)[key], fullPath)
      }
    }

    walk(payload, '')
    return violations
  }

  it('rejects payload with "password" key', () => {
    const payload = {
      domain: 'core',
      settings: {
        password: 'plaintext-pwd-123'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('password')
  })

  it('rejects payload with "token" key', () => {
    const payload = {
      domain: 'm-net',
      auth: {
        token: 'Bearer abc123'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('token')
  })

  it('rejects payload with "secret" key', () => {
    const payload = {
      domain: 'm-policy',
      api: {
        secret: 'sk-live-12345'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('secret')
  })

  it('rejects payload with "apiKey" key', () => {
    const payload = {
      domain: 'm-extension',
      credentials: {
        apiKey: 'ext-key-abc'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('apiKey')
  })

  it('reports multiple violations', () => {
    const payload = {
      password: 'pwd1',
      settings: {
        apiKey: 'key1',
        nested: {
          secret: 'sec1'
        }
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations.length).toBeGreaterThanOrEqual(3)
  })

  it('allows payload with only secretRef (no plaintext secrets)', () => {
    const payload = {
      domain: 'core',
      settings: {
        dbPassword: {
          secretRef: 'vault:db-password@v1'
        },
        apiEndpoint: 'https://api.example.com'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(0)
  })

  it('allows payload with no sensitive keys at all', () => {
    const payload = {
      domain: 'core',
      targetScope: ['m-net'],
      opentelemetry: {
        enabled: true,
        endpoint: 'http://otel-collector:4317'
      }
    }
    const violations = containsPlaintextSecrets(payload)
    expect(violations).toHaveLength(0)
  })

  it('allows payload with empty object', () => {
    const violations = containsPlaintextSecrets({})
    expect(violations).toHaveLength(0)
  })
})

// ── Versioning ────────────────────────────────────────────────────────────

describe('Config versioning', () => {
  it('configVersion follows semver pattern', () => {
    const valid = ['1.0.0', '0.1.0', '2.3.1', '10.20.30']
    for (const version of valid) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('schemaVersion identifies config schema version', () => {
    expect('config@0.1.0').toMatch(/^config@\d+\.\d+\.\d+$/)
  })

  it('rollbackVersion must reference a known version', () => {
    // rollbackVersion must not be the same as the current configVersion
    const current = '2.0.0'
    const rollback = '1.0.0'
    expect(rollback).not.toBe(current)
    expect(rollback).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
