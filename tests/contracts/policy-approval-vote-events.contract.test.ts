import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  ApprovalVoteTypeSchema,
  PolicyApprovalVoteEventPayloadSchema
} from '../../packages/contracts/src/schemas/policy.ts'

describe('Policy approval vote event contracts', () => {
  const validApprovePayload = {
    approvalId: 'approval-test-1',
    actor: 'security-admin',
    vote: 'approve' as const,
    reason: 'looks safe',
    timestamp: new Date().toISOString()
  }

  const validRejectPayload = {
    approvalId: 'approval-test-2',
    actor: 'admin',
    vote: 'reject' as const,
    timestamp: new Date().toISOString()
  }

  it('round-trips approve vote event payload via Effect Schema decode/encode', () => {
    const decoded = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(validApprovePayload)
    expect(decoded.approvalId).toBe('approval-test-1')
    expect(decoded.actor).toBe('security-admin')
    expect(decoded.vote).toBe('approve')
    expect(decoded.reason).toBe('looks safe')

    const encoded = Schema.encodeSync(PolicyApprovalVoteEventPayloadSchema)(decoded)
    const roundTripped = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(encoded)
    expect(roundTripped).toEqual(decoded)
  })

  it('round-trips reject vote event payload via Effect Schema decode/encode', () => {
    const decoded = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(validRejectPayload)
    expect(decoded.approvalId).toBe('approval-test-2')
    expect(decoded.actor).toBe('admin')
    expect(decoded.vote).toBe('reject')
    expect(decoded.reason).toBeUndefined()

    const encoded = Schema.encodeSync(PolicyApprovalVoteEventPayloadSchema)(decoded)
    const roundTripped = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(encoded)
    expect(roundTripped).toEqual(decoded)
  })

  it('rejects invalid vote payloads that miss required fields', () => {
    expect(() =>
      Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)({
        vote: 'approve'
      })
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)({
        approvalId: 'missing-actor-and-vote'
      })
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(null)
    ).toThrow()
  })

  it('rejects vote payloads with invalid actor values', () => {
    expect(() =>
      Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)({
        approvalId: 'approval-bad-actor',
        actor: 'superuser',
        vote: 'approve',
        timestamp: new Date().toISOString()
      })
    ).toThrow()
  })

  it('rejects vote payloads with invalid vote type values', () => {
    expect(() =>
      Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)({
        approvalId: 'approval-bad-vote',
        actor: 'admin',
        vote: 'abstain',
        timestamp: new Date().toISOString()
      })
    ).toThrow()
  })

  it('vote event payload contains expected fields: approvalId, actor, vote, reason?, timestamp', () => {
    const decoded = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(validApprovePayload)
    expect(decoded).toHaveProperty('approvalId')
    expect(decoded).toHaveProperty('actor')
    expect(decoded).toHaveProperty('vote')
    expect(decoded).toHaveProperty('timestamp')

    const withoutReason = Schema.decodeUnknownSync(PolicyApprovalVoteEventPayloadSchema)(
      validRejectPayload
    )
    expect(withoutReason.reason).toBeUndefined()
  })

  it('ApprovalVoteTypeSchema only allows approve and reject', () => {
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('approve')).toBe('approve')
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('reject')).toBe('reject')
    expect(() => Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('abstain')).toThrow()
    expect(() => Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('maybe')).toThrow()
  })

  describe('event subject naming convention', () => {
    const voteSubjects = [
      { vote: 'approve', subject: 'policy.approval.vote.approved' },
      { vote: 'reject', subject: 'policy.approval.vote.rejected' }
    ] as const

    for (const { vote, subject } of voteSubjects) {
      it(`policy.approval.vote.${vote} follows the policy.approval.vote.* convention`, () => {
        expect(subject).toMatch(/^policy\.approval\.vote\.(approved|rejected)$/)
        expect(subject.startsWith('policy.approval.vote.')).toBe(true)
      })
    }
  })
})
