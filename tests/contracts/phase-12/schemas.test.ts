import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { ApprovalStatusSchema, ApprovalVoteTypeSchema, PolicyApprovalSchema, PolicyApprovalVoteSchema, TaskSuspendedOperationSchema } from '../../../packages/contracts/src/schemas/policy.ts'
import { createApprovalRoutes, createInMemoryApprovalStore, createTestApproval } from '../../../services/m-policy/src/approval/index.ts'
import type { ActorId } from '../../../packages/contracts/src/index.ts'

describe('Phase 12 Effect Schema decode/encode', () => {
  it('ApprovalStatusSchema decodes all valid statuses', async () => {

    for (const status of ['pending', 'approved', 'rejected', 'expired', 'canceled'] as const) {
      const decoded = Schema.decodeUnknownSync(ApprovalStatusSchema)(status)
      expect(decoded).toBe(status)
    }
  })

  it('ApprovalStatusSchema rejects invalid status', async () => {

    expect(() => Schema.decodeUnknownSync(ApprovalStatusSchema)('invalid')).toThrow()
  })

  it('ApprovalVoteTypeSchema decodes approve and reject', async () => {

    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('approve')).toBe('approve')
    expect(Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('reject')).toBe('reject')
    expect(() => Schema.decodeUnknownSync(ApprovalVoteTypeSchema)('abstain')).toThrow()
  })

  it('PolicyApprovalSchema decodes a complete approval record', async () => {

    const approval = {
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
    }

    const decoded = Schema.decodeUnknownSync(PolicyApprovalSchema)(approval)
    expect(decoded.id).toBe('test-id')
    expect(decoded.originService).toBe('m-task')
    expect(decoded.status).toBe('pending')
  })

  it('PolicyApprovalVoteSchema decodes a vote record', async () => {

    const vote = {
      id: 'vote-id',
      approvalId: 'approval-id',
      actor: 'security-admin',
      vote: 'approve',
      reason: 'looks safe',
      createdAt: new Date().toISOString()
    }

    const decoded = Schema.decodeUnknownSync(PolicyApprovalVoteSchema)(vote)
    expect(decoded.vote).toBe('approve')
    expect(decoded.reason).toBe('looks safe')
  })

  it('TaskSuspendedOperationSchema decodes a suspended operation', async () => {

    const op = {
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
    }

    const decoded = Schema.decodeUnknownSync(TaskSuspendedOperationSchema)(op)
    expect(decoded.status).toBe('suspended')
    expect(decoded.action).toBe('task.cancel')
  })

  it('TaskSuspendedOperationSchema decodes resume_failed terminal state', async () => {
    const op = {
      id: 'op-id',
      policyDecisionId: 'pd-id',
      action: 'task.cancel',
      requestedBy: 'operator',
      resource: 'task:123',
      sanitizedPayload: { action: 'task:cancel' },
      correlationId: 'corr-1',
      idempotencyKey: 'key-1',
      status: 'resume_failed',
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      terminalReason: 'target_task_not_found'
    }

    const decoded = Schema.decodeUnknownSync(TaskSuspendedOperationSchema)(op)
    expect(decoded.status).toBe('resume_failed')
  })

  it('approval permissions stay in sync between literals and policy RBAC', async () => {
    const { approvalPermissions, permissions } = await import('../../../packages/contracts/src/literals.ts')
    const { rolePermissions } = await import('../../../packages/policy/src/index.ts')

    // approvalPermissions 中的所有权限必须出现在 permissions 列表中
    for (const perm of approvalPermissions) {
      expect(permissions).toContain(perm)
    }

    // security-admin 必须拥有所有 approvalPermissions
    for (const perm of approvalPermissions) {
      expect(rolePermissions['security-admin']).toContain(perm)
    }

    // admin 只有 policy:approval-read
    expect(rolePermissions['admin']).toContain('policy:approval-read')
    expect(rolePermissions['admin']).not.toContain('policy:approval-approve')
    expect(rolePermissions['admin']).not.toContain('policy:approval-reject')
    expect(rolePermissions['admin']).not.toContain('policy:approval-manage')
  })

  it('Elysia approval schemas match contract type shapes', async () => {
    // 确保 approval routes 中的 Elysia schema 与 contracts 类型保持一致
    const { createInMemoryApprovalStore, createTestApproval, createApprovalRoutes } = await import('../../../services/m-policy/src/approval/index.ts')

    const approval = createTestApproval()
    const store = createInMemoryApprovalStore([approval])
    const routes = createApprovalRoutes({
      auth: { async verify() { return { ok: true as const, actor: 'security-admin' as ActorId } } },
      async permissionsForActor() { return ['policy:approval-read'] },
      approvals: store,
      log: { async writeTimeline() {}, async writeFull() {}, async writeAudit() {} },
      events: { async publish() {} }
    })

    const response = await routes.handle(new Request('http://localhost/api/v0/policy/approvals', {
      headers: { authorization: 'Bearer test-token' }
    }))
    const body = await response.json() as { approvals: Array<Record<string, unknown>> }

    // Elysia 响应字段必须与 PolicyApproval 类型字段匹配
    expect(body.approvals[0]).toHaveProperty('id')
    expect(body.approvals[0]).toHaveProperty('policyDecisionId')
    expect(body.approvals[0]).toHaveProperty('originService')
    expect(body.approvals[0]).toHaveProperty('operationId')
    expect(body.approvals[0]).toHaveProperty('requestedBy')
    expect(body.approvals[0]).toHaveProperty('requiredAction')
    expect(body.approvals[0]).toHaveProperty('status')
    expect(body.approvals[0]).toHaveProperty('quorumRequired')
    expect(body.approvals[0]).toHaveProperty('expiresAt')
    expect(body.approvals[0]).toHaveProperty('createdAt')
    expect(body.approvals[0]).toHaveProperty('updatedAt')
  })
})
