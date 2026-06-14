import { t } from 'elysia'

export const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

export const riskSchema = t.Object({
  operationDangerLevel: t.Union([
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('critical')
  ]),
  suspicionScore: t.Number(),
  riskFactors: t.Array(t.String())
})

export const taskSchema = t.Object({
  id: t.String(),
  nodeId: t.String(),
  leafNodeId: t.String(),
  type: t.Literal('noop'),
  status: t.Union([
    t.Literal('accepted'),
    t.Literal('queued'),
    t.Literal('dispatched'),
    t.Literal('running'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('cancel_requested'),
    t.Literal('canceled'),
    t.Literal('timed_out')
  ]),
  createdAt: t.String(),
  updatedAt: t.String(),
  timeoutAt: t.Optional(t.String()),
  completedAt: t.Optional(t.String()),
  canceledAt: t.Optional(t.String())
})

export const policyBlockSchema = t.Object({
  policyDecision: t.Object({
    decisionId: t.String(),
    result: t.Union([
      t.Literal('require_manual_review'),
      t.Literal('require_multi_approval'),
      t.Literal('deny')
    ]),
    requiredAction: t.Optional(
      t.Union([t.Literal('manual_review'), t.Literal('multi_approval'), t.Undefined()])
    ),
    reasons: t.Array(t.String())
  }),
  risk: riskSchema
})

export const retryNotImplementedSchema = t.Object({
  error: t.Object({
    code: t.Literal('not_implemented_yet'),
    message: t.String()
  }),
  decisionId: t.String(),
  risk: riskSchema
})
