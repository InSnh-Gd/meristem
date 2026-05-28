import { Elysia, t } from 'elysia'
import { actorIds } from '../../../packages/contracts/src/index.ts'
import type { ActorId, ApprovalActionResponse, ApprovalDetailResponse, ApprovalListResponse, ApprovalStatus, PolicyApproval, PolicyApprovalVote } from '../../../packages/contracts/src/index.ts'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

type ServiceError = { code: string; message: string }

// 审批端口抽象，M-Policy 实际实现通过 DB adapter 连接 PostgreSQL。
export type ApprovalStore = {
  listApprovals(status?: ApprovalStatus): Promise<PolicyApproval[]>
  getApproval(id: string): Promise<PolicyApproval | null>
  getVotes(approvalId: string): Promise<PolicyApprovalVote[]>
  addVote(approvalId: string, actor: ActorId, vote: 'approve' | 'reject', reason?: string): Promise<PolicyApprovalVote>
  updateApprovalStatus(id: string, status: ApprovalStatus, completedAt?: string): Promise<PolicyApproval | null>
}

export type ApprovalDeps = {
  auth: {
    verify(token: string): Promise<{ ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
  }
  approvals: ApprovalStore
  log: {
    writeTimeline(input: { summary: string; subject?: string; correlationId?: string }): Promise<unknown>
    writeFull(input: { level: string; source: string; message: string; correlationId?: string; payload?: unknown }): Promise<unknown>
    writeAudit(input: { actor: ActorId | 'system'; action: string; resource: string; decisionId?: string; result: string; correlationId?: string }): Promise<unknown>
  }
  events: {
    publish(subject: string, event: unknown): Promise<unknown>
  }
  onApproved?: (approval: PolicyApproval) => Promise<void>
}

const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

const approvalSchema = t.Object({
  id: t.String(),
  policyDecisionId: t.String(),
  originService: t.String(),
  operationId: t.String(),
  requestedBy: t.UnionEnum(actorIds),
  requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('approved'),
    t.Literal('rejected'),
    t.Literal('expired'),
    t.Literal('canceled')
  ]),
  quorumRequired: t.Number(),
  expiresAt: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String())
})

const voteSchema = t.Object({
  id: t.String(),
  approvalId: t.String(),
  actor: t.UnionEnum(actorIds),
  vote: t.Union([t.Literal('approve'), t.Literal('reject')]),
  reason: t.Optional(t.String()),
  createdAt: t.String()
})

const approvalWithVotesSchema = t.Intersect([
  approvalSchema,
  t.Object({ votes: t.Array(voteSchema) })
])

const approvalListSchema = t.Object({
  approvals: t.Array(approvalSchema)
})

const approvalActionSchema = t.Object({
  approval: approvalSchema,
  votes: t.Array(voteSchema)
})

/**
 * 从 Bearer token 提取 actor，外部审批 API 统一使用 JWT 身份而非 internal token。
 */
async function requireExternalActor(deps: ApprovalDeps, headers: Record<string, string | undefined>): Promise<ActorId> {
  const token = extractBearerToken(headers.authorization)
  if (!token) throw Object.assign(new Error('Bearer token is required'), { status: 401, code: 'auth.missing_token' })
  const verified = await deps.auth.verify(token)
  if (!verified.ok) throw Object.assign(new Error(verified.message), { status: 401, code: verified.code })
  return verified.actor
}

/**
 * evaluateQuorum 根据当前投票状态判断审批是否达到 quorum。
 * manual_review 只需一票 approve；multi_approval 需要两个不同 security-admin 的 approve。
 * 任何一票 reject 立即拒绝。
 */
function evaluateQuorum(approval: PolicyApproval, votes: PolicyApprovalVote[]): ApprovalStatus | null {
  const rejectVotes = votes.filter((v) => v.vote === 'reject')
  if (rejectVotes.length > 0) return 'rejected'

  const approveVotes = votes.filter((v) => v.vote === 'approve')
  if (approveVotes.length >= approval.quorumRequired) return 'approved'

  return null
}

/**
 * M-Policy 外部审批 REST API，Bearer auth + M-Policy 权限。
 * 审批状态转换和 resume 行为通过 onApproved 回调通知来源服务。
 */
export function createApprovalRoutes(deps: ApprovalDeps) {
  return new Elysia({ prefix: '/api/v0/policy/approvals' })
    // 审批列表读取不在 Audit Log 路径上，只返回当前状态。
    .get(
      '/',
      async ({ headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        return withExtractedSpan('m-policy', 'm-policy.approval.list', headers, async () => {
          const approvals = await deps.approvals.listApprovals()
          return { approvals } satisfies ApprovalListResponse
        })
      },
      {
        response: {
          200: approvalListSchema,
          401: apiErrorSchema
        }
      }
    )
    // 审批详情读取不在 Audit Log 路径上。
    .get(
      '/:id',
      async ({ params, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        return withExtractedSpan('m-policy', 'm-policy.approval.get', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          const votes = await deps.approvals.getVotes(approval.id)
          return { ...approval, votes } satisfies ApprovalDetailResponse
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: approvalWithVotesSchema,
          401: apiErrorSchema,
          404: apiErrorSchema
        }
      }
    )
    // 审批投票：security-admin 可以 approve。
    // 每个 actor 只能投一次票；原始操作者不能 approve 自己的操作。
    // 投票后检查 quorum，达到则触发 onApproved 回调。
    .post(
      '/:id/approve',
      async ({ params, body, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        return withExtractedSpan('m-policy', 'm-policy.approval.approve', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          if (approval.status !== 'pending') return status(409, { error: { code: 'approval.not_pending', message: `approval is ${approval.status}` } })
          if (new Date(approval.expiresAt) < new Date()) {
            await deps.approvals.updateApprovalStatus(approval.id, 'expired')
            await deps.log.writeTimeline({ summary: `approval ${approval.id} expired`, subject: 'policy.approval.expired', correlationId: approval.operationId })
            return status(409, { error: { code: 'approval.expired', message: 'approval has expired' } })
          }
          if (approval.requestedBy === actor) {
            await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'self-approval denied', payload: { approvalId: approval.id, actor } })
            return status(403, { error: { code: 'approval.self_vote_denied', message: 'original actor cannot approve their own operation' } })
          }
          try {
            const vote = await deps.approvals.addVote(approval.id, actor, 'approve', body.reason)
            const votes = await deps.approvals.getVotes(approval.id)
            const terminal = evaluateQuorum(approval, votes)
            if (terminal) {
              const now = new Date().toISOString()
              await deps.approvals.updateApprovalStatus(approval.id, terminal, now)
              await deps.log.writeAudit({ actor, action: 'policy.approval.approve', resource: `approval:${approval.id}`, decisionId: approval.policyDecisionId, result: terminal })
              await deps.log.writeTimeline({ summary: `approval ${approval.id} ${terminal}`, subject: `policy.approval.${terminal}`, correlationId: approval.operationId })
              const updatedApproval = await deps.approvals.getApproval(approval.id)
              if (updatedApproval && deps.onApproved && terminal === 'approved') {
                await deps.onApproved(updatedApproval)
              }
              return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
            }
            await deps.log.writeAudit({ actor, action: 'policy.approval.vote', resource: `approval:${approval.id}`, result: 'vote_recorded' })
            const updatedApproval = await deps.approvals.getApproval(approval.id)
            return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('duplicate')) {
              await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'duplicate vote attempt', payload: { approvalId: approval.id, actor } })
              return status(409, { error: { code: 'approval.duplicate_vote', message: 'actor has already voted on this approval' } })
            }
            throw error
          }
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({ reason: t.Optional(t.String()) }),
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
    // 拒绝投票：security-admin 可以 reject，一票即拒绝。
    .post(
      '/:id/reject',
      async ({ params, body, headers, status }) => {
        const actor = await requireExternalActor(deps, headers)
        return withExtractedSpan('m-policy', 'm-policy.approval.reject', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          if (approval.status !== 'pending') return status(409, { error: { code: 'approval.not_pending', message: `approval is ${approval.status}` } })
          if (new Date(approval.expiresAt) < new Date()) {
            await deps.approvals.updateApprovalStatus(approval.id, 'expired')
            return status(409, { error: { code: 'approval.expired', message: 'approval has expired' } })
          }
          if (approval.requestedBy === actor) {
            await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'self-rejection denied', payload: { approvalId: approval.id, actor } })
            return status(403, { error: { code: 'approval.self_vote_denied', message: 'original actor cannot reject their own operation' } })
          }
          try {
            const vote = await deps.approvals.addVote(approval.id, actor, 'reject', body.reason)
            const now = new Date().toISOString()
            await deps.approvals.updateApprovalStatus(approval.id, 'rejected', now)
            await deps.log.writeAudit({ actor, action: 'policy.approval.reject', resource: `approval:${approval.id}`, decisionId: approval.policyDecisionId, result: 'rejected' })
            await deps.log.writeTimeline({ summary: `approval ${approval.id} rejected`, subject: 'policy.approval.rejected', correlationId: approval.operationId })
            const votes = await deps.approvals.getVotes(approval.id)
            const updatedApproval = await deps.approvals.getApproval(approval.id)
            return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('duplicate')) {
              await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'duplicate vote attempt', payload: { approvalId: approval.id, actor } })
              return status(409, { error: { code: 'approval.duplicate_vote', message: 'actor has already voted on this approval' } })
            }
            throw error
          }
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({ reason: t.Optional(t.String()) }),
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
}

export type ApprovalRoutes = ReturnType<typeof createApprovalRoutes>

/**
 * 内存审批存储，用于单元测试和依赖缺失时的降级路径。
 */
export function createInMemoryApprovalStore(initialApprovals: PolicyApproval[] = []): ApprovalStore {
  const approvals = [...initialApprovals]
  const votes: PolicyApprovalVote[] = []

  return {
    async listApprovals(status) {
      return status ? approvals.filter((a) => a.status === status) : [...approvals]
    },
    async getApproval(id) {
      return approvals.find((a) => a.id === id) ?? null
    },
    async getVotes(approvalId) {
      return votes.filter((v) => v.approvalId === approvalId)
    },
    async addVote(approvalId, actor, vote, reason) {
      const existing = votes.find((v) => v.approvalId === approvalId && v.actor === actor)
      if (existing) throw new Error('duplicate vote')
      const entry: PolicyApprovalVote = {
        id: crypto.randomUUID(),
        approvalId,
        actor,
        vote,
        ...(reason ? { reason } : {}),
        createdAt: new Date().toISOString()
      }
      votes.push(entry)
      return entry
    },
    async updateApprovalStatus(id, status, completedAt) {
      const approval = approvals.find((a) => a.id === id)
      if (!approval) return null
      approval.status = status
      approval.updatedAt = new Date().toISOString()
      if (completedAt) approval.completedAt = completedAt
      return approval
    }
  }
}

/**
 * 创建一个测试用的 pending approval，方便测试直接使用。
 */
export function createTestApproval(overrides: Partial<PolicyApproval> = {}): PolicyApproval {
  return {
    id: crypto.randomUUID(),
    policyDecisionId: crypto.randomUUID(),
    originService: 'm-task',
    operationId: crypto.randomUUID(),
    requestedBy: 'operator',
    requiredAction: 'manual_review',
    status: 'pending',
    quorumRequired: 1,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}
