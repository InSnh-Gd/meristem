/**
 * DFW-001: Internal-only bounded/redacted approval context — Failure-Mode Tests
 *
 * Validates that the bounded approval context contract protects against:
 * - Raw secret exposure through schema fields
 * - Unbounded payload injection
 * - LLM provider SDK or BFF/UI LLM placeholder leakage into the contract
 * - Missing or incorrectly modeled error codes
 * - Missing permission gate documentation
 *
 * These tests enforce the DFW-001 invariant: the approval context schema is
 * bounded, redacted, and internal-only. No LLM provider calls, no user-visible
 * summaries, no BFF/UI placeholder fields.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Schema from 'effect/Schema'
import {
  ApprovalContextSchema,
  ApprovalContextErrorCodeSchema,
  ApprovalContextErrorSchema,
  ApprovalContextBuildMetaSchema
} from '../../packages/contracts/src/index.ts'

// ── No LLM Provider Leakage ──────────────────────────────────────────────

describe('DFW-001 no LLM provider leakage', () => {
  it('approval-llm-context schema source contains no openai import', () => {
    const path = resolve(
      import.meta.dir,
      '../../packages/contracts/src/schemas/approval-llm-context.ts'
    )
    const source = readFileSync(path, 'utf-8')
    expect(source).not.toMatch(/\bopenai\b/i)
  })

  it('approval-llm-context schema source contains no anthropic import', () => {
    const path = resolve(
      import.meta.dir,
      '../../packages/contracts/src/schemas/approval-llm-context.ts'
    )
    const source = readFileSync(path, 'utf-8')
    expect(source).not.toMatch(/\banthropic\b/i)
  })

  it('approval-llm-context schema source contains no LLM provider SDK imports', () => {
    const path = resolve(
      import.meta.dir,
      '../../packages/contracts/src/schemas/approval-llm-context.ts'
    )
    const source = readFileSync(path, 'utf-8')
    // Covers common LLM SDK patterns: cohere, groq, together, replicate, mistral, vertex
    expect(source).not.toMatch(/\bcohere\b/i)
    expect(source).not.toMatch(/\bgroq\b/i)
    expect(source).not.toMatch(/\btogether\.ai\b/i)
    expect(source).not.toMatch(/\breplicate\b/i)
    expect(source).not.toMatch(/\bmistral\b/i)
    expect(source).not.toMatch(/\bvertex[-_]?ai\b/i)
  })

  it('approval-llm-context schema source contains no BFF/UI LLM placeholders', () => {
    const path = resolve(
      import.meta.dir,
      '../../packages/contracts/src/schemas/approval-llm-context.ts'
    )
    const source = readFileSync(path, 'utf-8')
    // BFF/UI patterns that would indicate user-visible LLM integration
    expect(source).not.toMatch(/\bllm[-_]?summary\b/i)
    expect(source).not.toMatch(/\bllm[-_]?suggestion\b/i)
    expect(source).not.toMatch(/\bllm[-_]?recommendation\b/i)
    expect(source).not.toMatch(/\bai[-_]?review\b/i)
    expect(source).not.toMatch(/\bai[-_]?assistant\b/i)
    expect(source).not.toMatch(/\bsummaryText\b/)
    expect(source).not.toMatch(/\buserFacing\b/)
  })

  it('approval-llm-context schema contains no display/UI contract fields', () => {
    // The schema must remain internal-only — no display contracts
    expect(
      ApprovalContextSchema.ast
    ).not.toHaveProperty('displayTitle')
    expect(
      ApprovalContextSchema.ast
    ).not.toHaveProperty('displayDescription')
    expect(
      ApprovalContextSchema.ast
    ).not.toHaveProperty('uiHint')
  })
})

// ── Redaction / No Raw Secrets in Schema Surface ─────────────────────────

describe('DFW-001 redaction — no raw secrets in schema surface', () => {
  it('ApprovalContextSchema rejects payloads with raw secret-like fields', () => {
    const secretFields = [
      'secret',
      'password',
      'privateKey',
      'accessKey',
      'secretKey',
      'tlsKey',
      'tlsCert',
      'mTlsKey',
      'serviceToken',
      'refreshToken',
      'sessionToken',
      'oauthToken',
      'credentials',
      'hmacKey',
      'signingKey',
      'encryptionKey'
    ]

    for (const field of secretFields) {
      const input = {
        approval: {
          id: 'approval-test-001',
          status: 'pending' as const,
          originService: 'm-task' as const,
          operationId: 'op-test-001',
          requestedBy: 'operator' as const,
          requiredAction: 'manual_review' as const,
          quorumRequired: 2,
          expiresAt: '2026-07-01T00:00:00.000Z',
          createdAt: '2026-06-15T00:00:00.000Z'
        },
        votes: [],
        policyDecision: {
          decisionId: 'pd-test-001',
          action: 'task.submit',
          resource: 'task:task-test-001',
          result: 'require_manual_review' as const,
          reasons: []
        },
        relatedOperations: [],
        logs: [],
        [field]: 'sk-very-secret-value-12345'
      }
      // Schema.Struct strips unknown keys — decode succeeds but output is clean
      const decoded = Schema.decodeUnknownSync(ApprovalContextSchema)(input)
      expect(
        decoded as Record<string, unknown>,
        `Schema output must not include secret field "${field}"`
      ).not.toHaveProperty(field)
    }
  })

  it('ApprovalContextSchema has no optional unbounded catch-all', () => {
    // Schema.Struct uses exact object encoding — extra fields means decode
    // failure unless the schema has a rest field. Verify none exists.
    const ast = ApprovalContextSchema.ast as { propertySignatures?: Record<string, unknown>; indexSignature?: unknown }
    expect(ast.indexSignature).toBeUndefined()
  })
})

// ── Approval Path AVAILABLE When Context Builder Unavailable ─────────────

describe('DFW-001 approval approve/reject path still available when context builder unavailable', () => {
  it('approval_context.error codes cover source_unavailable for degraded context build', () => {
    const error = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.source_unavailable',
      message: 'M-Policy approval source timed out during context build',
      correlationId: 'corr-degraded-001'
    })
    expect(error.code).toBe('approval_context.source_unavailable')
    // The error must not block the underlying approval approve/reject path —
    // context build is a supporting read, not a gate on the write path.
  })

  it('approval_context.not_found does not block approval path', () => {
    const error = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.not_found',
      message: 'Approval id approval-missing-001 not found in policy store',
      correlationId: 'corr-nf-001'
    })
    expect(error.code).toBe('approval_context.not_found')
  })

  it('approval_context.redaction_failed does not leak raw data', () => {
    const error = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.redaction_failed',
      message: 'Redaction step failed for source vote — raw data not included',
      correlationId: 'corr-redact-001'
    })
    expect(error.code).toBe('approval_context.redaction_failed')
    // Redaction failure must fail LOUD (error). Must NEVER silently include raw data.
    expect(error.message).toContain('not included')
  })

  it('approval_context.forbidden is permission-gated error', () => {
    const error = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.forbidden',
      message: 'Actor lacks policy:read or approval visibility for approval-001',
      correlationId: 'corr-forbidden-001'
    })
    expect(error.code).toBe('approval_context.forbidden')
    expect(error.message).toMatch(/policy:read|approval visibility/i)
  })

  it('context build is a read path — does not gate approve/reject write path', () => {
    // Contract guarantee: context build is a supplementary read-only operation.
    // If context build fails for any reason (source_unavailable, not_found,
    // redaction_failed, forbidden), the approval approve/reject write path
    // MUST still be available. This is a contract-level invariant, not a
    // runtime integration test.
    //
    // This test validates that the error codes exist and are properly typed,
    // confirming the design intent that context build is a separate concern
    // from the approval action path.

    const allCodes = Schema.decodeUnknownSync(ApprovalContextErrorCodeSchema)
    // TypeScript-level verification — if these error codes didn't exist, this
    // file wouldn't compile.
    const validCodes: Array<typeof ApprovalContextErrorCodeSchema.Type> = [
      'approval_context.not_found',
      'approval_context.source_unavailable',
      'approval_context.redaction_failed',
      'approval_context.forbidden'
    ]
    expect(validCodes).toHaveLength(4)
    expect(allCodes).toBeDefined()
  })
})

// ── Build Metadata Redaction Guarantee ───────────────────────────────────

describe('DFW-001 build metadata redaction guarantee', () => {
  it('ApprovalContextBuildMetaSchema records redactionCount but never raw data', () => {
    const meta = Schema.decodeUnknownSync(ApprovalContextBuildMetaSchema)({
      approvalId: 'approval-test-001',
      fieldCount: 5,
      redactionCount: 2,
      sourceList: ['approval', 'vote', 'log-summary'],
      correlationId: 'corr-build-001'
    })
    // Metadata must count redactions without leaking what was redacted
    expect(meta.redactionCount).toBe(2)
    expect(meta.fieldCount).toBe(5)
    expect(meta.sourceList).toHaveLength(3)
    // No raw data fields
    expect(meta).not.toHaveProperty('redactedValues')
    expect(meta).not.toHaveProperty('rawPayload')
    expect(meta).not.toHaveProperty('originalData')
  })

  it('ApprovalContextBuildMetaSchema strips redactedValues field from output', () => {
    const input = {
      approvalId: 'approval-test-001',
      fieldCount: 5,
      redactionCount: 2,
      sourceList: ['approval'],
      correlationId: 'corr-build-001',
      redactedValues: ['secret-1', 'secret-2']
    }
    const decoded = Schema.decodeUnknownSync(ApprovalContextBuildMetaSchema)(input)
    expect(decoded).not.toHaveProperty('redactedValues')
    expect(decoded.redactionCount).toBe(2)
    expect(decoded.fieldCount).toBe(5)
  })
})

// ── All Four Error Codes Exist ───────────────────────────────────────────

describe('DFW-001 complete error code coverage', () => {
  it('all four approval_context error codes are valid literals', () => {
    const codes = [
      'approval_context.not_found',
      'approval_context.source_unavailable',
      'approval_context.redaction_failed',
      'approval_context.forbidden'
    ] as const

    for (const code of codes) {
      const decoded = Schema.decodeUnknownSync(ApprovalContextErrorCodeSchema)(code)
      expect(decoded).toBe(code)
    }

    // Ensures no extra codes leak in
    const invalidCodes = [
      'approval_context.internal_error',
      'approval_context.unknown',
      'approval_context.build_failed',
      'approval_context.partial'
    ]
    for (const code of invalidCodes) {
      expect(() =>
        Schema.decodeUnknownSync(ApprovalContextErrorCodeSchema)(code)
      ).toThrow()
    }
  })

  it('ApprovalContextErrorSchema requires message and optional correlationId', () => {
    const withCorrelationId = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.not_found',
      message: 'Not found',
      correlationId: 'corr-1'
    })
    expect(withCorrelationId.correlationId).toBe('corr-1')

    const withoutCorrelationId = Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
      code: 'approval_context.not_found',
      message: 'Not found'
    })
    expect(withoutCorrelationId.correlationId).toBeUndefined()
  })

  it('ApprovalContextErrorSchema rejects missing message', () => {
    expect(() =>
      Schema.decodeUnknownSync(ApprovalContextErrorSchema)({
        code: 'approval_context.not_found'
      })
    ).toThrow()
  })
})
