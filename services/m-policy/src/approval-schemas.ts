import { t } from 'elysia'
import type {
  ActorId,
  ApprovalStatus,
  PolicyApproval,
  PolicyApprovalVote
} from '../../../packages/contracts/src/index.ts'
import { actorIds, type Permission } from '../../../packages/contracts/src/index.ts'

export type ApprovalStore = {
  createApproval(input: {
    policyDecisionId: string
    originService: PolicyApproval['originService']
    operationId: string
    requestedBy: ActorId
    requiredAction: PolicyApproval['requiredAction']
    quorumRequired: number
    expiresAt: string
  }): Promise<PolicyApproval>
  listApprovals(status?: ApprovalStatus): Promise<PolicyApproval[]>
  getApproval(id: string): Promise<PolicyApproval | null>
  getVotes(approvalId: string): Promise<PolicyApprovalVote[]>
  addVote(
    approvalId: string,
    actor: ActorId,
    vote: 'approve' | 'reject',
    reason?: string
  ): Promise<PolicyApprovalVote>
  updateApprovalStatus(
    id: string,
    status: ApprovalStatus,
    completedAt?: string
  ): Promise<PolicyApproval | null>
}

export type ApprovalDeps = {
  auth: {
    verify(
      token: string
    ): Promise<{ ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
  }
  approvals: ApprovalStore
  log: {
    writeTimeline(input: {
      summary: string
      subject?: string
      correlationId?: string
    }): Promise<unknown>
    writeFull(input: {
      level: string
      source: string
      message: string
      correlationId?: string
      payload?: unknown
    }): Promise<unknown>
    writeAudit(input: {
      actor: ActorId | 'system'
      action: string
      resource: string
      decisionId?: string
      result: string
      correlationId?: string
    }): Promise<unknown>
  }
  events: {
    publish(subject: string, event: unknown): Promise<unknown>
  }
  authorize(actor: ActorId, permission: Permission, resource: string): Promise<boolean>
  onApproved?: (approval: PolicyApproval) => Promise<void>
  onRejected?: (approval: PolicyApproval) => Promise<void>
}

export const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

export const approvalSchema = t.Object({
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

export const voteSchema = t.Object({
  id: t.String(),
  approvalId: t.String(),
  actor: t.UnionEnum(actorIds),
  vote: t.Union([t.Literal('approve'), t.Literal('reject')]),
  reason: t.Optional(t.String()),
  createdAt: t.String()
})

export const approvalWithVotesSchema = t.Intersect([
  approvalSchema,
  t.Object({ votes: t.Array(voteSchema) })
])

export const approvalListSchema = t.Object({
  approvals: t.Array(approvalSchema)
})

export const approvalActionSchema = t.Object({
  approval: approvalSchema,
  votes: t.Array(voteSchema)
})

export const approvalResponseSchema = t.Object({
  approval: approvalSchema
})

export const createApprovalBodySchema = t.Object({
  policyDecisionId: t.String(),
  originService: t.Union([t.Literal('m-task'), t.Literal('m-net')]),
  operationId: t.String(),
  requestedBy: t.UnionEnum(actorIds),
  requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
  quorumRequired: t.Number(),
  expiresAt: t.String()
})

export const approvalIdParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })

export const approvalVoteBodySchema = t.Object({ reason: t.Optional(t.String()) })
