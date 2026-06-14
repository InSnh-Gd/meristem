import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import type { ActorId } from '../../packages/contracts/src/index.ts'
import {
  ApprovalStatusSchema,
  ApprovalVoteTypeSchema,
  PolicyApprovalSchema,
  PolicyApprovalVoteSchema,
  TaskSuspendedOperationSchema
} from '../../packages/contracts/src/schemas/policy.ts'
import {
  createApprovalRoutes,
  createInMemoryApprovalStore,
  createTestApproval
} from '../../services/m-policy/src/approvals.ts'

describe('Approval schema and RBAC drift', () => {
  it('approval permissions are exported and mapped to security-admin', async () => {
    const { approvalPermissions, permissions } = await import(
      '../../packages/contracts/src/literals.ts'
    )
    const { rolePermissions } = await import('../../packages/policy/src/index.ts')

    for (const permission of approvalPermissions) {
      expect(permissions).toContain(permission)
      expect(rolePermissions['security-admin']).toContain(permission)
    }
    expect(rolePermissions.admin).toContain('policy:approval-read')
    expect(rolePermissions.admin).not.toContain('policy:approval-approve')
    expect(rolePermissions.operator).not.toContain('policy:approval-read')
  })

  it('approval status and vote schemas decode valid values and reject invalid values', async () => {
    for (const status of ['pending', 'approved', 'rejected', 'expired', 'canceled'] as const) {
      expect(Schema.decodeUnknownSync(ApprovalStatusSchema)(status)).toBe(status)
    }
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('approve')).toBe('approve')
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('reject')).toBe('reject')
    expect(() => Schema.decodeUnknownSync(ApprovalStatusSchema)('invalid')).toThrow()
    expect(() => Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('abstain')).toThrow()
  })

  it('approval, vote, and suspended operation schemas decode contract records', async () => {
    expect(
      Schema.decodeUnknownSync(PolicyApprovalSchema)({
        id: 'test-id',
        policyDecisionId: 'pd-id',
        originService: 'm-task',
        operationId: 'op-id',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        status: 'pending',
        quorumRequired: 1,
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).id
    ).toBe('test-id')

    expect(
      Schema.decodeUnknownSync(PolicyApprovalVoteSchema)({
        id: 'vote-id',
        approvalId: 'approval-id',
        actor: 'security-admin',
        vote: 'approve',
        reason: 'looks safe',
        createdAt: new Date().toISOString()
      }).vote
    ).toBe('approve')

    const decodedOp = Schema.decodeUnknownSync(TaskSuspendedOperationSchema)({
      id: 'op-id',
      policyDecisionId: 'pd-id',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: 'task:123',
      sanitizedPayload: { action: 'task:cancel' },
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      status: 'suspended',
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    })
    expect(decodedOp.action).toBe('task.cancel')
  })

  it('Elysia approval schemas match contract type shapes', async () => {
    const approval = createTestApproval()
    const routes = createApprovalRoutes({
      auth: {
        async verify() {
          return { ok: true as const, actor: 'security-admin' as ActorId }
        }
      },
      approvals: createInMemoryApprovalStore([approval]),
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit() {} },
      events: { async publish() {} },
      async authorize() {
        return true
      }
    })

    const response = await routes.handle(
      new Request('http://localhost/api/v0/policy/approvals', {
        headers: { authorization: 'Bearer test-token' }
      })
    )
    const body = (await response.json()) as { approvals: Array<Record<string, unknown>> }

    for (const key of [
      'id',
      'policyDecisionId',
      'originService',
      'operationId',
      'requestedBy',
      'requiredAction',
      'status',
      'quorumRequired',
      'expiresAt',
      'createdAt',
      'updatedAt'
    ]) {
      expect(body.approvals[0]).toHaveProperty(key)
    }
  })
})
