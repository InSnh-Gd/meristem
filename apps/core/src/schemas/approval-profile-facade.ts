import { t } from 'elysia'

const actorIdSchema = t.Union([
  t.Literal('viewer'),
  t.Literal('operator'),
  t.Literal('admin'),
  t.Literal('security-admin')
])

export const policyApprovalSchema = t.Object({
  id: t.String(),
  policyDecisionId: t.String(),
  originService: t.Union([t.Literal('m-task'), t.Literal('m-net')]),
  operationId: t.String(),
  requestedBy: actorIdSchema,
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

export const policyApprovalVoteSchema = t.Object({
  id: t.String(),
  approvalId: t.String(),
  actor: actorIdSchema,
  vote: t.Union([t.Literal('approve'), t.Literal('reject')]),
  reason: t.Optional(t.String()),
  createdAt: t.String()
})

export const approvalListResponseSchema = t.Object({
  approvals: t.Array(policyApprovalSchema)
})

export const approvalDetailResponseSchema = t.Object({
  id: t.String(),
  policyDecisionId: t.String(),
  originService: t.Union([t.Literal('m-task'), t.Literal('m-net')]),
  operationId: t.String(),
  requestedBy: actorIdSchema,
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
  completedAt: t.Optional(t.String()),
  votes: t.Array(policyApprovalVoteSchema)
})

export const mNetRegionalProfileSchema = t.Object({
  profileVersion: t.Union([t.Literal('m-net-cn@0.1.0'), t.Literal('m-net-default@0.1.0')]),
  region: t.Union([t.Literal('cn'), t.Literal('default')]),
  displayName: t.String(),
  schemaVersion: t.Literal('mnet-profile@0.1.0'),
  status: t.Union([t.Literal('available'), t.Literal('deprecated')]),
  rules: t.Record(t.String(), t.Unknown()),
  capabilities: t.Object({
    realDerpRelay: t.Literal(false),
    realTcpInterconnect: t.Literal(false),
    realUdpPathSwitching: t.Literal(false),
    controlPlaneOnly: t.Boolean()
  })
})

export const networkProfileListResponseSchema = t.Object({
  profiles: t.Array(mNetRegionalProfileSchema)
})
