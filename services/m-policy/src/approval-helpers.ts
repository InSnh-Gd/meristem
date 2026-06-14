import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  ApprovalStatus,
  PolicyApproval,
  PolicyApprovalVote
} from '../../../packages/contracts/src/index.ts'
import type { Permission } from '../../../packages/contracts/src/index.ts'
import type { ApprovalDeps, ApprovalStore } from './approval-schemas.ts'

/**
 * 从 Bearer token 提取 actor，外部审批 API 统一使用 JWT 身份而非 internal token。
 */
export async function requireExternalActor(
  deps: ApprovalDeps,
  headers: Record<string, string | undefined>
): Promise<ActorId> {
  const token = extractBearerToken(headers.authorization)
  if (!token)
    throw Object.assign(new Error('Bearer token is required'), {
      status: 401,
      code: 'auth.missing_token'
    })
  const verified = await deps.auth.verify(token)
  if (!verified.ok)
    throw Object.assign(new Error(verified.message), { status: 401, code: verified.code })
  return verified.actor
}

/**
 * requirePermission 将审批 API 的权限判定统一收敛到 M-Policy 决策入口。
 */
export async function requirePermission(
  deps: ApprovalDeps,
  actor: ActorId,
  permission: Permission,
  resource: string
): Promise<void> {
  if (await deps.authorize(actor, permission, resource)) return
  throw Object.assign(new Error('permission denied'), { status: 403, code: 'policy.denied' })
}

/**
 * 审批过期判定统一按 expiresAt 时间戳比较，避免不同 handler 重复实现。
 */
export function isApprovalExpired(approval: PolicyApproval, now: Date = new Date()): boolean {
  return new Date(approval.expiresAt) < now
}

/**
 * duplicate vote 依赖存储层唯一性约束，路由层只需要识别统一错误语义。
 */
export function isDuplicateVoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('duplicate')
}

/**
 * 内存审批存储，用于单元测试和依赖缺失时的降级路径。
 */
export function createInMemoryApprovalStore(
  initialApprovals: PolicyApproval[] = []
): ApprovalStore {
  const approvals = [...initialApprovals]
  const votes: PolicyApprovalVote[] = []

  return {
    async createApproval(input) {
      const now = new Date().toISOString()
      const approval: PolicyApproval = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        originService: input.originService,
        operationId: input.operationId,
        requestedBy: input.requestedBy,
        requiredAction: input.requiredAction,
        status: 'pending',
        quorumRequired: input.quorumRequired,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now
      }
      approvals.push(approval)
      return approval
    },
    async listApprovals(status) {
      return status ? approvals.filter(approval => approval.status === status) : [...approvals]
    },
    async getApproval(id) {
      return approvals.find(approval => approval.id === id) ?? null
    },
    async getVotes(approvalId) {
      return votes.filter(vote => vote.approvalId === approvalId)
    },
    async addVote(approvalId, actor, vote, reason) {
      const existing = votes.find(entry => entry.approvalId === approvalId && entry.actor === actor)
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
      const approval = approvals.find(entry => entry.id === id)
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

export function withUpdatedStatus(
  approval: PolicyApproval,
  status: ApprovalStatus,
  completedAt?: string
): PolicyApproval {
  const updatedAt = completedAt ?? new Date().toISOString()
  return {
    ...approval,
    status,
    updatedAt,
    ...(completedAt ? { completedAt } : {})
  }
}
