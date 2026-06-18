/**
 * DFW-013: M-Net runtime config secretRef — Contract Tests
 *
 * Validates that the MNetRuntimeConfigSchema enforces secretRef-only fields
 * and rejects all plaintext TLS, STUN, TURN, Headscale, and routing credentials
 * at the schema level.
 *
 * Contract:
 * - MNetRuntimeConfigSchema decodes valid secretRef-only payloads.
 * - Plaintext TLS/STUN/TURN/Headscale fields fail decode.
 * - SecretRefFieldSchema decodes { secretRefId: string } exactly.
 * - SecretRefFieldSchema rejects extra plaintext fields.
 * - Empty runtime config (no optional fields) decodes successfully.
 * - All optional fields decode independently.
 */

import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetRuntimeConfigSchema,
  SecretRefFieldSchema
} from '../../packages/contracts/src/schemas/runtime-config.ts'

// ── Valid fixtures ──────────────────────────────────────────────────────

function makeValidRuntimeConfig(overrides?: Record<string, unknown>) {
  return {
    wstunnelRelay: { secretRefId: 'secret-wstunnel-001' },
    tcpInterconnect: { secretRefId: 'secret-tcp-001' },
    udpPath: { secretRefId: 'secret-udp-001' },
    headscaleEndpoint: { secretRefId: 'secret-headscale-001' },
    routingTable: { secretRefId: 'secret-route-001' },
    ...overrides
  }
}

// ── SecretRefFieldSchema decode ─────────────────────────────────────────

describe('SecretRefFieldSchema decode', () => {
  it('decodes { secretRefId: string }', () => {
    const decoded = Schema.decodeUnknownSync(SecretRefFieldSchema)({
      secretRefId: 'secret-001'
    })
    expect(decoded.secretRefId).toBe('secret-001')
  })

  it('rejects missing secretRefId', () => {
    expect(() => Schema.decodeUnknownSync(SecretRefFieldSchema)({})).toThrow()
  })

  it('rejects secretRefId as number', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefFieldSchema)({
        secretRefId: 42
      })
    ).toThrow()
  })

  it('strips extra unknown plaintext fields (struct strips by default)', () => {
    const decoded = Schema.decodeUnknownSync(SecretRefFieldSchema)({
      secretRefId: 'secret-001',
      tlsCertificate: '-----BEGIN CERTIFICATE-----\nMII...',
      stunPassword: 'super-secret-stun',
      turnSharedSecret: 'turn-hmac-key',
      headscaleKey: 'mkey:abc123',
      apiKey: 'sk-ant-api03-xxxx'
    })
    // Only secretRefId survives; all plaintext is stripped
    expect(decoded.secretRefId).toBe('secret-001')
    expect(decoded).not.toHaveProperty('tlsCertificate')
    expect(decoded).not.toHaveProperty('stunPassword')
    expect(decoded).not.toHaveProperty('turnSharedSecret')
    expect(decoded).not.toHaveProperty('headscaleKey')
    expect(decoded).not.toHaveProperty('apiKey')
    // The output must have exactly one key
    expect(Object.keys(decoded)).toEqual(['secretRefId'])
  })

  it('SecretRefFieldSchema has exactly one key: secretRefId', () => {
    const keys = Object.keys(SecretRefFieldSchema.fields)
    expect(keys).toEqual(['secretRefId'])
  })
})

// ── MNetRuntimeConfigSchema decode ──────────────────────────────────────

describe('MNetRuntimeConfigSchema decode', () => {
  it('decodes valid runtime config with all secretRef fields', () => {
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(makeValidRuntimeConfig())
    expect(decoded.wstunnelRelay?.secretRefId).toBe('secret-wstunnel-001')
    expect(decoded.tcpInterconnect?.secretRefId).toBe('secret-tcp-001')
    expect(decoded.udpPath?.secretRefId).toBe('secret-udp-001')
    expect(decoded.headscaleEndpoint?.secretRefId).toBe('secret-headscale-001')
    expect(decoded.routingTable?.secretRefId).toBe('secret-route-001')
  })

  it('decodes empty runtime config (no optional fields)', () => {
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({})
    expect(decoded.wstunnelRelay).toBeUndefined()
    expect(decoded.tcpInterconnect).toBeUndefined()
    expect(decoded.udpPath).toBeUndefined()
    expect(decoded.headscaleEndpoint).toBeUndefined()
    expect(decoded.routingTable).toBeUndefined()
  })

  it('decodes runtime config with only wstunnelRelay set', () => {
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({
      wstunnelRelay: { secretRefId: 'secret-wstunnel-only' }
    })
    expect(decoded.wstunnelRelay?.secretRefId).toBe('secret-wstunnel-only')
    expect(decoded.tcpInterconnect).toBeUndefined()
    expect(decoded.udpPath).toBeUndefined()
    expect(decoded.headscaleEndpoint).toBeUndefined()
    expect(decoded.routingTable).toBeUndefined()
  })

  it('decodes runtime config with only routingTable set', () => {
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({
      routingTable: { secretRefId: 'secret-route-only' }
    })
    expect(decoded.routingTable?.secretRefId).toBe('secret-route-only')
    expect(decoded.wstunnelRelay).toBeUndefined()
  })

  it('strips unknown plaintext fields from top-level runtime config', () => {
    const input = {
      wstunnelRelay: { secretRefId: 'secret-wstunnel-001' },
      tlsKey: '-----BEGIN PRIVATE KEY-----\nMII...',
      stunServer: 'stun://user:password@stun.example.com:3478',
      turnCredential: 'hmac-sha1-key-material',
      headscaleApiKey: 'abc123xyz'
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    expect(decoded.wstunnelRelay?.secretRefId).toBe('secret-wstunnel-001')
    expect(decoded).not.toHaveProperty('tlsKey')
    expect(decoded).not.toHaveProperty('stunServer')
    expect(decoded).not.toHaveProperty('turnCredential')
    expect(decoded).not.toHaveProperty('headscaleApiKey')
  })
})

// ── Plaintext rejection: schema-level validation ────────────────────────

describe('MNetRuntimeConfigSchema rejects plaintext transport credentials', () => {
  const plaintextFields = [
    'tlsCertificate',
    'tlsKey',
    'tlsKeyPEM',
    'stunPassword',
    'stunSecret',
    'turnPassword',
    'turnSharedSecret',
    'headscaleApiKey',
    'headscalePreauthKey',
    'wstunnelKey',
    'routingKey',
    'wireguardPrivateKey',
    'wireguardPsk',
    'peerSecret',
    'interconnectToken'
  ]

  for (const field of plaintextFields) {
    it(`rejects plaintext field "${field}" — strips from decoded output`, () => {
      const input = {
        ...makeValidRuntimeConfig(),
        [field]: 'dangerous-plaintext-value-should-never-survive'
      }
      const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
      expect(decoded).not.toHaveProperty(field)
    })
  }

  it('rejects plaintext credentials nested inside wstunnelRelay', () => {
    const input = {
      wstunnelRelay: {
        secretRefId: 'secret-wstunnel-001',
        tlsCert: '-----BEGIN CERTIFICATE-----\n...',
        stunPassword: 'nested-plaintext'
      },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' },
      udpPath: { secretRefId: 'secret-udp-001' },
      headscaleEndpoint: { secretRefId: 'secret-headscale-001' },
      routingTable: { secretRefId: 'secret-route-001' }
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    expect(decoded.wstunnelRelay?.secretRefId).toBe('secret-wstunnel-001')
    expect(decoded.wstunnelRelay).not.toHaveProperty('tlsCert')
    expect(decoded.wstunnelRelay).not.toHaveProperty('stunPassword')
  })

  it('rejects plaintext credentials nested inside headscaleEndpoint', () => {
    const input = {
      headscaleEndpoint: {
        secretRefId: 'secret-headscale-001',
        apiKey: 'mkey:plaintext-api-key'
      }
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    expect(decoded.headscaleEndpoint?.secretRefId).toBe('secret-headscale-001')
    expect(decoded.headscaleEndpoint).not.toHaveProperty('apiKey')
  })

  it('rejects plaintext credentials nested inside udpPath (STUN/TURN)', () => {
    const input = {
      udpPath: {
        secretRefId: 'secret-udp-001',
        stunServer: 'stun.l.google.com:19302',
        turnServer: 'turn:turn.example.com:3478',
        turnUsername: 'user',
        turnCredential: 'password'
      }
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    expect(decoded.udpPath?.secretRefId).toBe('secret-udp-001')
    expect(decoded.udpPath).not.toHaveProperty('stunServer')
    expect(decoded.udpPath).not.toHaveProperty('turnServer')
    expect(decoded.udpPath).not.toHaveProperty('turnUsername')
    expect(decoded.udpPath).not.toHaveProperty('turnCredential')
  })
})

// ── Schema surface verification ────────────────────────────────────────

describe('MNetRuntimeConfigSchema surface verification', () => {
  it('MNetRuntimeConfigSchema has exactly 5 optional secretRef-gated fields', () => {
    const keys = Object.keys(MNetRuntimeConfigSchema.fields)
    expect(keys).toEqual([
      'wstunnelRelay',
      'tcpInterconnect',
      'udpPath',
      'headscaleEndpoint',
      'routingTable'
    ])
  })

  it('all MNetRuntimeConfigSchema fields are optional', () => {
    // Verify the schema decodes an empty object (all fields optional)
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({})
    expect(decoded).toBeDefined()
    for (const key of Object.keys(MNetRuntimeConfigSchema.fields)) {
      expect(decoded[key as keyof typeof decoded]).toBeUndefined()
    }
  })

  it('MNetRuntimeConfigSchema has no index signature (no catch-all)', () => {
    const ast = MNetRuntimeConfigSchema.ast as {
      propertySignatures?: Record<string, unknown>
      indexSignature?: unknown
    }
    expect(ast.indexSignature).toBeUndefined()
  })

  it('MNetRuntimeConfigSchema does not accept null / non-object payloads', () => {
    expect(() => Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(null)).toThrow()
    expect(() => Schema.decodeUnknownSync(MNetRuntimeConfigSchema)('not an object')).toThrow()
    expect(() => Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(42)).toThrow()
  })
})
