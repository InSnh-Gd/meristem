import { t } from 'elysia'
import { actorIds } from '../../../../packages/contracts/src/index.ts'

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

export const createApprovalSchema = t.Object({
  policyDecisionId: t.String({ minLength: 1 }),
  originService: t.Literal('m-task'),
  operationId: t.String({ minLength: 1 }),
  requestedBy: t.UnionEnum(actorIds),
  requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
  expiresAt: t.String({ minLength: 1 })
})
