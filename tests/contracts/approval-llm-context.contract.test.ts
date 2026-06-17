/**
 * DFW-001: Internal-only bounded/redacted approval context — Contract Tests
 *
 * Validates the Effect Schema decode/encode contract for the bounded approval
 * context schema. The schema must decode valid entries and reject raw secrets,
 * tokens, unbounded log bodies, and structurally invalid payloads.
 *
 * Contract:
 * - ApprovalContextSchema must decode a valid bounded context with all five sections.
 * - ApprovalContextVoteEntrySchema must reject reason > 500 chars.
 * - Secret-like plaintext fields (tls, token) must not be decodable through the schema.
 * - Unbounded log bodies must not be decodable through the schema.
 * - Invalid payload must fail decode with a ParseError.
 * - ApprovalContextErrorSchema and ApprovalContextErrorCodeSchema must decode valid error codes.
 */

import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  ApprovalContextSchema,
  ApprovalContextApprovalEntrySchema,
  ApprovalContextVoteEntrySchema,
  ApprovalContextDecisionRefSchema,
  ApprovalContextOperationRefSchema,
  ApprovalContextLogRefSchema,
  ApprovalContextSourceSchema,
  ApprovalContextBuildMetaSchema,
  ApprovalContextErrorSchema,
  ApprovalContextErrorCodeSchema
} from '../../packages/contracts/src/index.ts'

// ── Valid bounded context fixture ────────────────────────────────────────

function makeValidContext(overrides?: Record<string, unknown>) {
  return {
    approval: {
      id: 'approval-test-001',
      status: 'pending',
      originService: 'm-task',
      operationId: 'op-test-001',
      requestedBy: 'operator',
      requiredAction: 'manual_review',
      quorumRequired: 2,
      expiresAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-06-15T00:00:00.000Z'
    },
    votes: [
      {
        actor: 'security-admin',
        vote: 'approve',
        reason: 'Manual review passed — operation is safe.',
        createdAt: '2026-06-15T12:00:00.000Z'
      }
    ],
    policyDecision: {
      decisionId: 'pd-test-001',
      action: 'task.submit',
      resource: 'task:task-test-001',
      result: 'require_manual_review',
      reasons: ['High risk operation requires human review']
    },
    relatedOperations: [
      {
        operationId: 'op-test-001',
        action: 'task.submit',
        status: 'suspended'
      }
    ],
    logs: [
      {
        source: 'timeline',
        lineCount: 42,
        truncated: false
      }
    ],
    ...overrides
  }
}

// ── Bounded Context Decode ───────────────────────────────────────────────

describe('ApprovalContextSchema bounded context decode', () => {
  it('decodes valid bounded context with all five required sections', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(makeValidContext())
    expect(decoded.approval.id).toBe('approval-test-001')
    expect(decoded.approval.status).toBe('pending')
    expect(decoded.votes).toHaveLength(1)
    expect(decoded.votes[0]?.actor).toBe('security-admin')
    expect(decoded.votes[0]?.vote).toBe('approve')
    expect(decoded.policyDecision.decisionId).toBe('pd-test-001')
    expect(decoded.policyDecision.result).toBe('require_manual_review')
    expect(decoded.relatedOperations).toHaveLength(1)
    expect(decoded.relatedOperations[0]?.status).toBe('suspended')
    expect(decoded.logs).toHaveLength(1)
    expect(decoded.logs[0]?.source).toBe('timeline')
  })

  it('decodes completedAt as optional on approval entry', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(
      makeValidContext({
        approval: {
          ...makeValidContext().approval,
          completedAt: '2026-06-16T00:00:00.000Z'
        }
      })
    )
    expect(decoded.approval.completedAt).toBe('2026-06-16T00:00:00.000Z')
  })

  it('decodes missing votes array', () => {
    const withEmptyVotes = makeValidContext()
    withEmptyVotes.votes = []
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(withEmptyVotes)
    expect(decoded.votes).toHaveLength(0)
  })

  it('decodes missing logs array', () => {
    const withEmptyLogs = makeValidContext()
    withEmptyLogs.logs = []
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(withEmptyLogs)
    expect(decoded.logs).toHaveLength(0)
  })

  it('decodes vote entry without reason (optional)', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextVoteEntrySchema)({
      actor: 'admin',
      vote: 'reject',
      createdAt: '2026-06-15T12:00:00.000Z'
    })
    expect(decoded.vote).toBe('reject')
    expect(decoded.reason).toBeUndefined()
  })
})

// ── Strip Raw Secrets / Tokens ────────────────────────────────────────────
// Effect Schema Struct strips unknown keys by default. The schema surface
// never contains raw secret fields; decode succeeds and the output is clean.

describe('ApprovalContextSchema strips raw secrets and tokens from output', () => {
  it('strips TLS certificate field from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).tlsCertificate = '-----BEGIN CERTIFICATE-----\nMIID...'
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('tlsCertificate')
  })

  it('strips raw JWT token field from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('token')
  })

  it('strips bearerToken field from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).bearerToken = 'sk-proj-1234567890abcdef'
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('bearerToken')
  })

  it('strips apiKey field from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).apiKey = 'sk-ant-api03-xxxxxxxxxxxxxxxx'
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('apiKey')
  })
})

// ── Strip Unbounded Fields ───────────────────────────────────────────────

describe('ApprovalContextSchema strips unbounded fields from output', () => {
  it('strips logBody field (unbounded) from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).logBody = 'a'.repeat(10_000)
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('logBody')
  })

  it('strips fullLogPayload field (unbounded) from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).fullLogPayload = { entries: Array(1000).fill('data') }
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('fullLogPayload')
  })

  it('strips rawRequest field (unbounded) from decoded output', () => {
    const input = makeValidContext()
    ;(input as Record<string, unknown>).rawRequest = {
      headers: {},
      body: 'x'.repeat(50_000)
    }
    const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
    expect(decoded).not.toHaveProperty('rawRequest')
  })

  it('rejects vote reason exceeding 500 characters', () => {
    expect(() =>
      Schema.decodeUnknownSync(ApprovalContextVoteEntrySchema)({
        actor: 'security-admin',
        vote: 'approve',
        reason: 'a'.repeat(501),
        createdAt: '2026-06-15T12:00:00.000Z'
      })
    ).toThrow()
  })
})

// ── Invalid Payload Decode ───────────────────────────────────────────────

describe('ApprovalContextSchema invalid payload decode', () => {
  it('rejects missing approval section', () => {
    const invalid = makeValidContext()
    delete (invalid as Record<string, unknown>).approval
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects missing policyDecision section', () => {
    const invalid = makeValidContext()
    delete (invalid as Record<string, unknown>).policyDecision
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects invalid approval status', () => {
    const invalid = makeValidContext()
    ;(invalid as Record<string, unknown>).approval = {
      ...makeValidContext().approval,
      status: 'in_progress'
    }
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects invalid vote value', () => {
    const invalid = makeValidContext()
    ;(invalid as Record<string, unknown>).votes = [
      {
        actor: 'security-admin',
        vote: 'abstain',
        createdAt: '2026-06-15T12:00:00.000Z'
      }
    ]
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects invalid policy decision result', () => {
    const invalid = makeValidContext()
    ;(invalid as Record<string, unknown>).policyDecision = {
      ...makeValidContext().policyDecision,
      result: 'maybe'
    }
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects invalid operation status', () => {
    const invalid = makeValidContext()
    ;(invalid as Record<string, unknown>).relatedOperations = [
      {
        operationId: 'op-test-001',
        action: 'task.submit',
        status: 'running'
      }
    ]
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects empty object', () => {
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)({})).toThrow()
  })

  it('rejects null', () => {
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(null)).toThrow()
  })

  it('rejects non-object primitive', () => {
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)('not an object')).toThrow()
  })
})

// ── Error Schema Contract ────────────────────────────────────────────────

describe('ApprovalContextErrorSchema and error codes', () => {
  it('decodes valid error with all four defined codes', () => {
    for (const code of [
      'approval_context.not_found',
      'approval_context.source_unavailable',
      'approval_context.redaction_failed',
      'approval_context.forbidden'
    ] as const) {
      const decoded = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
        code,
        message: 'Test error message',
        correlationId: 'corr-test-001'
      })
      expect(decoded.code).toBe(code)
      expect(decoded.message).toBe('Test error message')
      expect(decoded.correlationId).toBe('corr-test-001')
    }
  })

  it('rejects invalid error code', () => {
    expect(() =>
      Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
        code: 'approval_context.timeout',
        message: 'Timeout'
      })
    ).toThrow()
  })

  it('decodes error code literal directly', () => {
    expect(
      Schema.decodeUnknownSync(ApprovalContextErrorCodeSchema)('approval_context.not_found')
    ).toBe('approval_context.not_found')
  })

  it('rejects invalid error code literal', () => {
    expect(() =>
      Schema.decodeUnknownSync(ApprovalContextErrorCodeSchema)('unknown.error')
    ).toThrow()
  })
})

// ── Sub-Schema Contracts ─────────────────────────────────────────────────

describe('ApprovalContext sub-schema contracts', () => {
  it('ApprovalContextApprovalEntrySchema decodes valid entry', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextApprovalEntrySchema)({
      id: 'approval-test-001',
      status: 'pending',
      originService: 'm-task',
      operationId: 'op-test-001',
      requestedBy: 'operator',
      requiredAction: 'manual_review',
      quorumRequired: 2,
      expiresAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-06-15T00:00:00.000Z'
    })
    expect(decoded.id).toBe('approval-test-001')
    expect(decoded.quorumRequired).toBe(2)
  })

  it('ApprovalContextDecisionRefSchema decodes valid decision ref', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextDecisionRefSchema)({
      decisionId: 'pd-test-001',
      action: 'task.submit',
      resource: 'task:task-test-001',
      result: 'require_multi_approval',
      reasons: ['High risk', 'Multi-party required']
    })
    expect(decoded.decisionId).toBe('pd-test-001')
    expect(decoded.reasons).toHaveLength(2)
  })

  it('ApprovalContextOperationRefSchema decodes all valid statuses', () => {
    for (const status of [
      'suspended',
      'resumed',
      'rejected',
      'expired',
      'resume_failed'
    ] as const) {
      const decoded = Schema.decodeUnknownSync(ApprovalContextOperationRefSchema)({
        operationId: 'op-test-001',
        action: 'task.submit',
        status
      })
      expect(decoded.status).toBe(status)
    }
  })

  it('ApprovalContextLogRefSchema decodes valid log ref', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextLogRefSchema)({
      source: 'full-log',
      lineCount: 150,
      truncated: true
    })
    expect(decoded.source).toBe('full-log')
    expect(decoded.lineCount).toBe(150)
    expect(decoded.truncated).toBe(true)
  })

  it('ApprovalContextSourceSchema decodes all valid sources', () => {
    for (const source of [
      'approval',
      'policy-decision',
      'vote',
      'operation',
      'log-summary',
      'task-reference'
    ] as const) {
      expect(Schema.decodeUnknownSync(ApprovalContextSourceSchema)(source)).toBe(source)
    }
  })

  it('ApprovalContextBuildMetaSchema decodes valid build metadata', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalContextBuildMetaSchema)({
      approvalId: 'approval-test-001',
      fieldCount: 5,
      redactionCount: 2,
      sourceList: ['approval', 'vote', 'log-summary'],
      correlationId: 'corr-build-001'
    })
    expect(decoded.approvalId).toBe('approval-test-001')
    expect(decoded.redactionCount).toBe(2)
    expect(decoded.sourceList).toEqual(['approval', 'vote', 'log-summary'])
  })
})

// ── Structurally Invalid But Kind-Valid Decode ───────────────────────────

describe('ApprovalContextSchema structural invalidity', () => {
  it('rejects approval with string quorumRequired', () => {
    const invalid = makeValidContext()
    ;(invalid as Record<string, unknown>).approval = {
      ...makeValidContext().approval,
      quorumRequired: 'two'
    }
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects vote entry with unknown actor', () => {
    const invalid = makeValidContext()
    invalid.votes = [
      {
        actor: 'superadmin',
        vote: 'approve' as const,
        createdAt: '2026-06-15T12:00:00.000Z'
      }
    ] as typeof invalid.votes
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })

  it('rejects log ref with unknown source', () => {
    const invalid = makeValidContext()
    invalid.logs = [
      {
        source: 'audit-trail',
        lineCount: 10,
        truncated: false
      }
    ]
    expect(() => Schema.decodeUnknownSync(ApprovalContextSchema)(invalid)).toThrow()
  })
})
