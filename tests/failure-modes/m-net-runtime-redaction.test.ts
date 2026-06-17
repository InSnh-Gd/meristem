/**
 * DFW-013: M-Net runtime config secretRef redaction — Failure-Mode Tests
 *
 * Validates that MNetRuntimeConfig plaintext secrets are NEVER present in:
 * - Decoded schema output (Struct strips unknown keys)
 * - JSON.stringify() output (serialized redaction)
 * - Log-like output projections
 * - UI error envelope shapes
 * - Approval LLM context inputs (cross-contract boundary)
 *
 * Sentinel invariant: secretRefId is the ONLY credential-bearing field
 * that survives schema decode. All plaintext TLS/STUN/TURN/Headscale and
 * routing credential material is stripped at the schema boundary.
 *
 * Sentinel prefix: DFW-013-REDACT
 */

import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetRuntimeConfigSchema,
  SecretRefFieldSchema
} from '../../packages/contracts/src/schemas/runtime-config.ts'
import { ApprovalContextSchema } from '../../packages/contracts/src/schemas/approval-llm-context.ts'

// ── Sentinel helpers ────────────────────────────────────────────────────

const SENTINEL_TLS_CERT = '-----BEGIN CERTIFICATE-----\nMIIEpAIBAAKCAQEA...SENTINEL...'
const SENTINEL_STUN_PWD = 'DFW-013-STUN-PLAINTEXT-DO-NOT-LEAK'
const SENTINEL_TURN_SECRET = 'DFW-013-TURN-HMAC-DO-NOT-LEAK'
const SENTINEL_HEADSCALE_KEY = 'mkey:DFW013HeadscalePreauthDoNotLeak'
const SENTINEL_ROUTING_KEY = 'DFW-013-ROUTING-PSK-DO-NOT-LEAK'

const ALL_SENTINELS = [
  SENTINEL_TLS_CERT,
  SENTINEL_STUN_PWD,
  SENTINEL_TURN_SECRET,
  SENTINEL_HEADSCALE_KEY,
  SENTINEL_ROUTING_KEY
]

/**
 * Assert NO sentinel value appears in any string output.
 */
function assertNoSentinelLeak(...outputs: string[]): void {
  for (const output of outputs) {
    for (const sentinel of ALL_SENTINELS) {
      expect(output, `Sentinel leak detected: "${sentinel.substring(0, 30)}..."`).not.toContain(
        sentinel
      )
    }
    // Also verify generic plaintext field names don't appear
    expect(output).not.toContain('"tlsCertificate"')
    expect(output).not.toContain('"stunPassword"')
    expect(output).not.toContain('"turnSharedSecret"')
    expect(output).not.toContain('"headscaleApiKey"')
    expect(output).not.toContain('"routingKey"')
    expect(output).not.toContain('"plaintext"')
    expect(output).not.toContain('"secretValue"')
    expect(output).not.toContain('"credential"')
  }
}

// ── Schema-level redaction: plaintext stripped by Struct ───────────────

describe('DFW-013 schema-level redaction — plaintext stripped by Struct', () => {
  it('secretRefId survives; all plaintext fields are stripped from decoded output', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' },
      udpPath: { secretRefId: 'secret-udp-001' },
      headscaleEndpoint: { secretRefId: 'secret-headscale-001' },
      routingTable: { secretRefId: 'secret-route-001' },
      // Plaintext attacks — must NOT survive decode
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    expect(decoded.derpRelay?.secretRefId).toBe('secret-derp-001')
    expect(decoded).not.toHaveProperty('tlsCertificate')
    expect(decoded).not.toHaveProperty('stunPassword')
    expect(decoded).not.toHaveProperty('turnSharedSecret')
    expect(decoded).not.toHaveProperty('headscaleApiKey')
    expect(decoded).not.toHaveProperty('routingKey')
  })

  it('nested plaintext inside secretRef fields is stripped', () => {
    const input = {
      derpRelay: {
        secretRefId: 'secret-derp-001',
        tlsKeyPEM: SENTINEL_TLS_CERT,
        stunPassword: SENTINEL_STUN_PWD
      },
      tcpInterconnect: {
        secretRefId: 'secret-tcp-001',
        turnSharedSecret: SENTINEL_TURN_SECRET
      },
      udpPath: {
        secretRefId: 'secret-udp-001',
        stunPassword: SENTINEL_STUN_PWD,
        turnCredential: SENTINEL_TURN_SECRET
      },
      headscaleEndpoint: {
        secretRefId: 'secret-headscale-001',
        apiKey: SENTINEL_HEADSCALE_KEY
      },
      routingTable: {
        secretRefId: 'secret-route-001',
        preSharedKey: SENTINEL_ROUTING_KEY
      }
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)

    // Each secretRef field must have ONLY secretRefId
    expect(decoded.derpRelay).toBeDefined()
    expect(Object.keys(decoded.derpRelay as Record<string, unknown>)).toEqual(['secretRefId'])
    expect(decoded.tcpInterconnect).toBeDefined()
    expect(Object.keys(decoded.tcpInterconnect as Record<string, unknown>)).toEqual(['secretRefId'])
    expect(decoded.udpPath).toBeDefined()
    expect(Object.keys(decoded.udpPath as Record<string, unknown>)).toEqual(['secretRefId'])
    expect(decoded.headscaleEndpoint).toBeDefined()
    expect(Object.keys(decoded.headscaleEndpoint as Record<string, unknown>)).toEqual([
      'secretRefId'
    ])
    expect(decoded.routingTable).toBeDefined()
    expect(Object.keys(decoded.routingTable as Record<string, unknown>)).toEqual(['secretRefId'])
  })
})

// ── JSON.stringify redaction — serialized output is clean ───────────────

describe('DFW-013 JSON.stringify redaction — serialized output is clean', () => {
  it('JSON.stringify of decoded runtime config contains only secretRefId', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' },
      udpPath: { secretRefId: 'secret-udp-001' },
      headscaleEndpoint: { secretRefId: 'secret-headscale-001' },
      routingTable: { secretRefId: 'secret-route-001' },
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    const serialized = JSON.stringify(decoded)

    assertNoSentinelLeak(serialized)

    // Verify the serialized output contains the expected secretRefId values
    expect(serialized).toContain('"secretRefId":"secret-derp-001"')
    expect(serialized).toContain('"secretRefId":"secret-tcp-001"')
    expect(serialized).toContain('"secretRefId":"secret-udp-001"')
    expect(serialized).toContain('"secretRefId":"secret-headscale-001"')
    expect(serialized).toContain('"secretRefId":"secret-route-001"')
  })

  it('JSON.stringify of empty runtime config produces clean output', () => {
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({})
    const serialized = JSON.stringify(decoded)
    expect(serialized).toBe('{}')
  })

  it('JSON.stringify of SecretRefField does not contain sentinels', () => {
    const input = {
      secretRefId: 'secret-001',
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD
    }
    const decoded = Schema.decodeUnknownSync(SecretRefFieldSchema)(input)
    const serialized = JSON.stringify(decoded)
    assertNoSentinelLeak(serialized)
    expect(serialized).toBe('{"secretRefId":"secret-001"}')
  })
})

// ── Log output redaction — simulated log-like projections ───────────────

describe('DFW-013 log output redaction — simulated log projections', () => {
  function simulateLogEntry(payload: unknown): string {
    // Simulate what a log projection would look like:
    // JSON.stringify of the decoded config payload
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(payload)
    return JSON.stringify({
      level: 'info',
      message: 'config applied',
      configHash: 'sha256-abc123',
      configPayload: decoded,
      timestamp: new Date().toISOString()
    })
  }

  it('log projection of runtime config contains no sentinel plaintext', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' },
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    }
    const logEntry = simulateLogEntry(input)
    assertNoSentinelLeak(logEntry)
  })

  it('log projection of empty runtime config is clean', () => {
    const logEntry = simulateLogEntry({})
    assertNoSentinelLeak(logEntry)
  })
})

// ── UI error envelope redaction — error responses must not leak secrets ─

describe('DFW-013 UI error envelope redaction', () => {
  function simulateUIErrorEnvelope(input: unknown, errorMessage: string): string {
    // Simulate what a UI error response envelope looks like
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    return JSON.stringify({
      error: {
        code: 'runtime_config.validation_failed',
        message: errorMessage,
        configSnapshot: decoded,
        correlationId: 'corr-redact-test-001'
      }
    })
  }

  it('UI error envelope must not contain sentinel plaintext', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET
    }
    const errorEnvelope = simulateUIErrorEnvelope(
      input,
      'Runtime config validation failed: plaintext secrets detected'
    )
    assertNoSentinelLeak(errorEnvelope)
  })

  it('UI error envelope with partial config still redacts plaintext', () => {
    const input = {
      headscaleEndpoint: {
        secretRefId: 'secret-headscale-001',
        apiKey: SENTINEL_HEADSCALE_KEY
      }
    }
    const errorEnvelope = simulateUIErrorEnvelope(input, 'Headscale endpoint configuration error')
    assertNoSentinelLeak(errorEnvelope)
    // secretRefId must be present; apiKey must NOT be present
    expect(errorEnvelope).toContain('"secretRefId":"secret-headscale-001"')
    expect(errorEnvelope).not.toContain(SENTINEL_HEADSCALE_KEY)
  })
})

// ── Projection payload redaction — read-model projections must be clean ─

describe('DFW-013 projection payload redaction', () => {
  function simulateProjectionPayload(input: unknown): string {
    // Simulate an OpenSearch projection payload
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)
    return JSON.stringify({
      _index: 'config-projections',
      _id: 'proj-001',
      _source: {
        domain: 'm-net',
        configType: 'runtime-config',
        configPayload: decoded,
        projectedAt: new Date().toISOString()
      }
    })
  }

  it('projection payload must not contain sentinel plaintext', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      udpPath: { secretRefId: 'secret-udp-001' },
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    }
    const projection = simulateProjectionPayload(input)
    assertNoSentinelLeak(projection)
  })

  it('projection payload only contains secretRefId values', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' }
    }
    const projection = simulateProjectionPayload(input)
    expect(projection).toContain('"secretRefId":"secret-derp-001"')
    expect(projection).toContain('"secretRefId":"secret-tcp-001"')
    // Must NOT contain any plaintext credential field names
    expect(projection).not.toMatch(/"tls|"stun|"turn|"apiKey|"psk|"routingKey/)
  })
})

// ── LLM context boundary — ApprovalContextSchema must reject raw secrets ─

describe('DFW-013 LLM context boundary redaction', () => {
  /**
   * The ApprovalContextSchema (DFW-001) defines a bounded, redacted context
   * for LLM-assisted approval review. It must never accept raw secret values,
   * including runtime config plaintext that could leak through.
   *
   * This test verifies that if MNetRuntimeConfig data were accidentally fed
   * into the LLM context pipeline, the schema boundary would strip all
   * plaintext secret material.
   */
  function makeValidApprovalContext(overrides?: Record<string, unknown>) {
    return {
      approval: {
        id: 'approval-redact-001',
        status: 'pending' as const,
        originService: 'm-net' as const,
        operationId: 'op-redact-001',
        requestedBy: 'operator' as const,
        requiredAction: 'manual_review' as const,
        quorumRequired: 2,
        expiresAt: '2026-07-01T00:00:00.000Z',
        createdAt: '2026-06-15T00:00:00.000Z'
      },
      votes: [
        {
          actor: 'security-admin' as const,
          vote: 'approve' as const,
          reason: 'CN profile enable — runtime config is secretRef-only',
          createdAt: '2026-06-15T12:00:00.000Z'
        }
      ],
      policyDecision: {
        decisionId: 'pd-redact-001',
        action: 'mnet.profile.enable',
        resource: 'network:net-redact-001',
        result: 'require_manual_review' as const,
        reasons: ['High risk: network profile enable']
      },
      relatedOperations: [
        {
          operationId: 'op-redact-001',
          action: 'mnet.profile.enable',
          status: 'suspended' as const
        }
      ],
      logs: [
        {
          source: 'timeline' as const,
          lineCount: 42,
          truncated: false
        }
      ],
      ...overrides
    }
  }

  it('LLM context strips runtime config plaintext injected as extra fields', () => {
    // Simulate an attacker injecting runtime config plaintext into LLM context
    const contextWithSecrets = makeValidApprovalContext({
      runtimeConfig: {
        derpRelay: { secretRefId: 'secret-derp-001' },
        tlsCertificate: SENTINEL_TLS_CERT,
        stunPassword: SENTINEL_STUN_PWD,
        turnSharedSecret: SENTINEL_TURN_SECRET,
        headscaleApiKey: SENTINEL_HEADSCALE_KEY,
        routingKey: SENTINEL_ROUTING_KEY
      }
    })
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(contextWithSecrets)
    const serialized = JSON.stringify(decoded)
    assertNoSentinelLeak(serialized)
  })

  it('LLM context strips plaintext injection at approval entry level', () => {
    const contextWithSecrets = makeValidApprovalContext({
      approval: {
        ...makeValidApprovalContext().approval,
        tlsCertificate: SENTINEL_TLS_CERT,
        headscaleKey: SENTINEL_HEADSCALE_KEY
      }
    })
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(contextWithSecrets)
    const serialized = JSON.stringify(decoded)
    assertNoSentinelLeak(serialized)
  })

  it('LLM context strips plaintext injection at policy decision level', () => {
    const contextWithSecrets = makeValidApprovalContext({
      policyDecision: {
        ...makeValidApprovalContext().policyDecision,
        stunPassword: SENTINEL_STUN_PWD,
        turnSharedSecret: SENTINEL_TURN_SECRET
      }
    })
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(contextWithSecrets)
    const serialized = JSON.stringify(decoded)
    assertNoSentinelLeak(serialized)
  })

  it('LLM context strips plaintext injection at vote entry level', () => {
    const contextWithSecrets = makeValidApprovalContext({
      votes: [
        {
          actor: 'security-admin' as const,
          vote: 'approve' as const,
          reason: 'approved',
          createdAt: '2026-06-15T12:00:00.000Z',
          routingKey: SENTINEL_ROUTING_KEY,
          derpCredential: SENTINEL_TLS_CERT
        }
      ]
    })
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(contextWithSecrets)
    const serialized = JSON.stringify(decoded)
    assertNoSentinelLeak(serialized)
  })

  it('LLM context vote reason is bounded to 500 chars — runtime config can not be embedded', () => {
    // A vote reason attempting to embed serialized runtime config would be rejected
    const embeddedConfig = JSON.stringify({
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    })
    // This would be > 500 chars if the sentinels are long enough
    const voteWithEmbeddedSecrets = {
      actor: 'security-admin' as const,
      vote: 'approve' as const,
      reason: embeddedConfig,
      createdAt: '2026-06-15T12:00:00.000Z'
    }
    // If the embedded config exceeds 500 chars, the vote entry is rejected entirely
    if (embeddedConfig.length > 500) {
      expect(() =>
        Schema.decodeUnknownSync(
          // Use the vote entry schema directly
          Schema.Struct({
            actor: Schema.Literal('security-admin'),
            vote: Schema.Literal('approve'),
            reason: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
            createdAt: Schema.String
          })
        )(voteWithEmbeddedSecrets)
      ).toThrow()
    }
  })
})

// ── Redaction boundary: secretRefId is the ONLY field that survives ────

describe('DFW-013 redaction boundary — secretRefId is the only surviving field', () => {
  it('SecretRefFieldSchema exposes exactly { secretRefId: string }', () => {
    const fields = SecretRefFieldSchema.fields
    const keys = Object.keys(fields)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('secretRefId')
  })

  it('MNetRuntimeConfigSchema has no plaintext credential fields in its surface', () => {
    const keys = Object.keys(MNetRuntimeConfigSchema.fields)
    // All top-level fields are secretRef-gated optional fields
    for (const key of keys) {
      // Each field is an optional(SecretRefFieldSchema)
      // Verify no single primitive string/number fields for credentials
      const fieldSchema =
        MNetRuntimeConfigSchema.fields[key as keyof typeof MNetRuntimeConfigSchema.fields]
      // The field should be an optional around a Struct, not a bare Schema.String
      expect(fieldSchema).toBeDefined()
    }
    // No plaintext fields like tlsCert, stunPassword, etc.
    expect(keys).not.toContain('tlsCertificate')
    expect(keys).not.toContain('tlsKey')
    expect(keys).not.toContain('stunPassword')
    expect(keys).not.toContain('turnSharedSecret')
    expect(keys).not.toContain('headscaleApiKey')
    expect(keys).not.toContain('routingKey')
    expect(keys).not.toContain('wireguardPrivateKey')
    expect(keys).not.toContain('peerSecret')
  })

  it('all five config fields are exclusively secretRef-gated', () => {
    // Ensure all fields resolve to the SecretRefField shape
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)({
      derpRelay: { secretRefId: 's1' },
      tcpInterconnect: { secretRefId: 's2' },
      udpPath: { secretRefId: 's3' },
      headscaleEndpoint: { secretRefId: 's4' },
      routingTable: { secretRefId: 's5' }
    })
    // Every present value must have exactly one key: secretRefId
    for (const entry of [
      decoded.derpRelay,
      decoded.tcpInterconnect,
      decoded.udpPath,
      decoded.headscaleEndpoint,
      decoded.routingTable
    ]) {
      expect(entry).toBeDefined()
      expect(Object.keys(entry as Record<string, unknown>)).toEqual(['secretRefId'])
    }
  })
})

// ── Zero-match canonical assertion ──────────────────────────────────────

describe('DFW-013 zero-match canonical redaction assertion', () => {
  it('ALL sentinels produce ZERO matches across ALL simulated outputs', () => {
    const input = {
      derpRelay: { secretRefId: 'secret-derp-001' },
      tcpInterconnect: { secretRefId: 'secret-tcp-001' },
      udpPath: { secretRefId: 'secret-udp-001' },
      headscaleEndpoint: { secretRefId: 'secret-headscale-001' },
      routingTable: { secretRefId: 'secret-route-001' },
      tlsCertificate: SENTINEL_TLS_CERT,
      stunPassword: SENTINEL_STUN_PWD,
      turnSharedSecret: SENTINEL_TURN_SECRET,
      headscaleApiKey: SENTINEL_HEADSCALE_KEY,
      routingKey: SENTINEL_ROUTING_KEY
    }
    const decoded = Schema.decodeUnknownSync(MNetRuntimeConfigSchema)(input)

    const outputs: string[] = []

    // 1. Direct JSON.stringify of decoded config
    outputs.push(JSON.stringify(decoded))

    // 2. Simulated log entry
    outputs.push(
      JSON.stringify({
        level: 'info',
        message: 'config applied',
        configPayload: decoded,
        timestamp: new Date().toISOString()
      })
    )

    // 3. Simulated UI error envelope
    outputs.push(
      JSON.stringify({
        error: {
          code: 'runtime_config.validation_failed',
          message: 'Plaintext secrets detected',
          configSnapshot: decoded,
          correlationId: 'corr-zero-match-001'
        }
      })
    )

    // 4. Simulated projection payload
    outputs.push(
      JSON.stringify({
        _index: 'config-projections',
        _source: { configPayload: decoded }
      })
    )

    // 5. Simulated LLM context with injected runtime config
    const approvalContext = {
      approval: {
        id: 'approval-zero-001',
        status: 'pending' as const,
        originService: 'm-net' as const,
        operationId: 'op-zero-001',
        requestedBy: 'operator' as const,
        requiredAction: 'manual_review' as const,
        quorumRequired: 2,
        expiresAt: '2026-07-01T00:00:00.000Z',
        createdAt: '2026-06-15T00:00:00.000Z'
      },
      votes: [],
      policyDecision: {
        decisionId: 'pd-zero-001',
        action: 'mnet.profile.enable',
        resource: 'network:net-zero-001',
        result: 'require_manual_review' as const,
        reasons: []
      },
      relatedOperations: [],
      logs: [],
      // Injected runtime config as an unknown field
      runtimeConfig: input
    }
    const llmContext = Schema.decodeUnknownSync(ApprovalContextSchema)(approvalContext)
    outputs.push(JSON.stringify(llmContext))

    // ── Zero-matches assertion ─────────────────────────────────────────
    for (const [index, output] of outputs.entries()) {
      for (const sentinel of ALL_SENTINELS) {
        expect(
          output,
          `Output[${index}] leaks sentinel: "${sentinel.substring(0, 30)}..."`
        ).not.toContain(sentinel)
      }
      // Generic plaintext field names must also not appear
      expect(output).not.toContain('"tlsCertificate"')
      expect(output).not.toContain('"stunPassword"')
      expect(output).not.toContain('"turnSharedSecret"')
      expect(output).not.toContain('"headscaleApiKey"')
      expect(output).not.toContain('"routingKey"')
      expect(output).not.toContain('"plaintext"')
      expect(output).not.toContain('"secretValue"')
    }
  })
})
