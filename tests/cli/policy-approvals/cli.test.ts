import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../../apps/m-cli/src/cli.ts'
import type { ApprovalListResponse, ApprovalDetailResponse, ApprovalActionResponse, PolicyApprovalVote } from '../../../packages/contracts/src/index.ts'

// Phase 12 CLI 审批命令测试：覆盖 list、show、approve、reject 命令和错误路径。

describe('meristem policy approvals CLI', () => {
  function approvalVote(input: { id: string; approvalId: string; vote: 'approve' | 'reject'; reason?: string }): PolicyApprovalVote {
    return {
      id: input.id,
      approvalId: input.approvalId,
      actor: 'security-admin',
      vote: input.vote,
      ...(input.reason ? { reason: input.reason } : {}),
      createdAt: new Date().toISOString()
    }
  }

  it('lists pending approvals', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async listApprovals() {
        calls.push('listApprovals')
        return {
          approvals: [{
            id: 'approval-1',
            policyDecisionId: 'pd-1',
            originService: 'm-task',
            operationId: 'op-1',
            requestedBy: 'operator',
            requiredAction: 'manual_review',
            status: 'pending',
            quorumRequired: 1,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }]
        } satisfies ApprovalListResponse
      }
    })

    const result = await cli.run(['policy', 'approvals', 'list'])
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['listApprovals'])
    expect(result.stdout).toContain('"id": "approval-1"')
  })

  it('shows approval detail with votes', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async getApproval(id) {
        calls.push(`getApproval:${id}`)
        return {
          id,
          policyDecisionId: 'pd-1',
          originService: 'm-task',
          operationId: 'op-1',
          requestedBy: 'operator',
          requiredAction: 'manual_review',
          status: 'pending',
          quorumRequired: 1,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          votes: []
        } satisfies ApprovalDetailResponse
      }
    })

    const result = await cli.run(['policy', 'approvals', 'show', 'approval-1'])
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['getApproval:approval-1'])
    expect(result.stdout).toContain('"id": "approval-1"')
    expect(result.stdout).toContain('"votes": []')
  })

  it('approves with optional reason', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async approveApproval(id, reason) {
        calls.push(`approve:${id}:${reason ?? 'no-reason'}`)
        return {
          approval: {
            id,
            policyDecisionId: 'pd-1',
            originService: 'm-task',
            operationId: 'op-1',
            requestedBy: 'operator',
            requiredAction: 'manual_review',
            status: 'approved',
            quorumRequired: 1,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          votes: [approvalVote({ id: 'vote-1', approvalId: id, vote: 'approve', ...(reason ? { reason } : {}) })]
        } satisfies ApprovalActionResponse
      }
    })

    const result = await cli.run(['policy', 'approvals', 'approve', 'approval-1', '--reason', 'looks safe'])
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['approve:approval-1:looks safe'])
    expect(result.stdout).toContain('"status": "approved"')
  })

  it('rejects with optional reason', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async rejectApproval(id, reason) {
        calls.push(`reject:${id}:${reason ?? 'no-reason'}`)
        return {
          approval: {
            id,
            policyDecisionId: 'pd-1',
            originService: 'm-task',
            operationId: 'op-1',
            requestedBy: 'operator',
            requiredAction: 'manual_review',
            status: 'rejected',
            quorumRequired: 1,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          votes: [approvalVote({ id: 'vote-1', approvalId: id, vote: 'reject', ...(reason ? { reason } : {}) })]
        } satisfies ApprovalActionResponse
      }
    })

    const result = await cli.run(['policy', 'approvals', 'reject', 'approval-1', '--reason', 'security concern'])
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['reject:approval-1:security concern'])
    expect(result.stdout).toContain('"status": "rejected"')
  })

  it('returns non-zero exit on missing approval-id', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async getApproval() { throw new Error('should not be called') }
    })

    const result = await cli.run(['policy', 'approvals', 'show'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('usage: meristem policy approvals show')
  })

  it('returns non-zero exit on invalid subcommand', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') }
    })

    const result = await cli.run(['policy', 'approvals', 'invalid'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('usage: meristem policy approvals')
  })

  it('returns non-zero exit on missing client method', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') }
    })

    const result = await cli.run(['policy', 'approvals', 'list'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('CLI client missing listApprovals')
  })
})

describe('meristem policy approvals CLI error paths', () => {
  it('returns non-zero exit on self-approval error from API', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async approveApproval() { throw new Error('original actor cannot approve their own operation') }
    })

    const result = await cli.run(['policy', 'approvals', 'approve', 'approval-1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('original actor cannot approve')
  })

  it('returns non-zero exit on duplicate vote error from API', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async approveApproval() { throw new Error('actor has already voted on this approval') }
    })

    const result = await cli.run(['policy', 'approvals', 'approve', 'approval-1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('already voted')
  })

  it('returns non-zero exit on expired approval error from API', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async approveApproval() { throw new Error('approval has expired') }
    })

    const result = await cli.run(['policy', 'approvals', 'approve', 'approval-1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('expired')
  })

  it('returns non-zero exit on resume failure from API', async () => {
    const cli = createCliRunner({
      async status() { throw new Error('should not be called') },
      async approveApproval() { throw new Error('suspended operation not found') }
    })

    const result = await cli.run(['policy', 'approvals', 'approve', 'nonexistent-id'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not found')
  })
})
