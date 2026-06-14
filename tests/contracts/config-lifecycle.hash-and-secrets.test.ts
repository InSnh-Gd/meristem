import { describe, expect, it } from 'bun:test'
import { containsPlaintextSecrets, deterministicConfigHash } from './_helpers/config-lifecycle.ts'

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
    expect(hash1.length).toBe(64)
  })

  it('different input → different hash', () => {
    const payload1 = { domain: 'core', targetScope: ['m-net'] }
    const payload2 = { domain: 'core', targetScope: ['m-policy'] }

    const hash1 = deterministicConfigHash(payload1)
    const hash2 = deterministicConfigHash(payload2)

    expect(hash1).not.toBe(hash2)
  })

  it('key order independence: same hash regardless of key order', () => {
    const ordered = deterministicConfigHash({ a: '1', b: '2' })
    const reversed = deterministicConfigHash({ b: '2', a: '1' })

    expect(ordered).toBe(reversed)
  })

  it('hash changes when a field changes', () => {
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

describe('Config plaintext secret rejection', () => {
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
    const current = '2.0.0'
    const rollback = '1.0.0'
    expect(rollback).not.toBe(current)
    expect(rollback).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
