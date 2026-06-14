import { t } from 'elysia'
import { actorIds, permissions } from '../../../../packages/contracts/src/index.ts'

export const policyDecisionSchema = t.Object({
  id: t.String(),
  actor: t.UnionEnum(actorIds),
  action: t.UnionEnum(permissions),
  resource: t.String(),
  result: t.Union([
    t.Literal('allow'),
    t.Literal('deny'),
    t.Literal('require_manual_review'),
    t.Literal('require_multi_approval')
  ]),
  reasons: t.Array(t.String()),
  operationDangerLevel: t.Optional(
    t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('critical')])
  ),
  suspicionScore: t.Optional(t.Number()),
  riskFactors: t.Optional(t.Array(t.String())),
  requiredAction: t.Optional(t.Union([t.Literal('manual_review'), t.Literal('multi_approval')])),
  createdAt: t.String()
})
