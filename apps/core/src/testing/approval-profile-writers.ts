import { err, ok } from '../../../../packages/common/src/result.ts'
import type {
  ApprovalWriterPort,
  NetworkProfileWriterPort
} from '../types/approval-profile-writers.ts'

const NOW = '2026-06-15T00:00:00.000Z'

/** 写端口确定性控制选项，用于测试中控制 mock 行为 */
export type WriterMockOptions = {
  forceError?: { code: string; message: string }
  notFoundApprovalIds?: Set<string>
  conflictNetworkIds?: Set<string>
  approveSucceeds?: boolean
  rejectSucceeds?: boolean
  profileSetSucceeds?: boolean
}

const CANNED_APPROVAL = {
  id: 'approval-write-test-1',
  policyDecisionId: 'decision-write-test-1',
  originService: 'm-net' as const,
  operationId: 'operation-write-test-1',
  requestedBy: 'operator' as const,
  requiredAction: 'manual_review' as const,
  status: 'pending' as const,
  quorumRequired: 1,
  expiresAt: '2026-06-15T01:00:00.000Z',
  createdAt: NOW,
  updatedAt: NOW
}

const CANNED_VOTE = {
  id: 'vote-write-test-1',
  approvalId: 'approval-write-test-1',
  actor: 'security-admin' as const,
  vote: 'approve' as const,
  reason: 'approved via test',
  createdAt: NOW
}

/**
 * createApprovalWriterPort 为测试提供确定性内存审批写端口。
 * 默认行为：所有调用成功（便于愉快路径测试）。
 * 通过 WriterMockOptions 控制错误、404 等场景。
 */
export function createApprovalWriterPort(opts: WriterMockOptions = {}): ApprovalWriterPort {
  return {
    async approve(id, _body, context) {
      if (opts.forceError) return err(opts.forceError)
      if (opts.notFoundApprovalIds?.has(id)) {
        return err({ code: 'approval.not_found', message: 'approval not found' })
      }
      if (opts.approveSucceeds === false) {
        return err({ code: 'approval.conflict', message: 'approval already processed' })
      }
      return ok({
        approval: { ...CANNED_APPROVAL, id, status: 'approved' as const },
        votes: [{ ...CANNED_VOTE, approvalId: id, actor: context.actor, vote: 'approve' as const }]
      })
    },
    async reject(id, _body, context) {
      if (opts.forceError) return err(opts.forceError)
      if (opts.notFoundApprovalIds?.has(id)) {
        return err({ code: 'approval.not_found', message: 'approval not found' })
      }
      if (opts.rejectSucceeds === false) {
        return err({ code: 'approval.conflict', message: 'approval already processed' })
      }
      return ok({
        approval: { ...CANNED_APPROVAL, id, status: 'rejected' as const },
        votes: [{ ...CANNED_VOTE, approvalId: id, actor: context.actor, vote: 'reject' as const }]
      })
    }
  }
}

/**
 * createNetworkProfileWriterPort 为测试提供确定性内存 profile 写端口。
 * 默认行为：根据 profileVersion 决定返回 enable 或 disable 响应。
 */
export function createNetworkProfileWriterPort(
  opts: WriterMockOptions = {}
): NetworkProfileWriterPort {
  return {
    async setProfile(networkId, body) {
      if (opts.forceError) return err(opts.forceError)
      if (opts.conflictNetworkIds?.has(networkId)) {
        return err({
          code: 'profile.enable.invalid_state',
          message: 'cannot enable from current state'
        })
      }
      if (opts.profileSetSucceeds === false) {
        return err({ code: 'feature.unavailable', message: 'profile features not available' })
      }
      // 根据 profileVersion 决定返回 enable 或 disable 响应
      if (body.profileVersion === 'm-net-default@0.1.0') {
        return ok({
          status: 'disabled',
          profileVersion: 'm-net-default@0.1.0',
          correlationId: 'correlation-write-test-disable-1'
        })
      }
      return ok({
        status: 'pending_approval',
        operationId: 'operation-write-test-1',
        approvalId: 'approval-write-test-1',
        correlationId: 'correlation-write-test-1'
      })
    }
  }
}
