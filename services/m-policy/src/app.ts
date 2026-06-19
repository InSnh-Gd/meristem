import { Elysia, t } from 'elysia'
import type { ActorId, Permission, PolicyDecision } from '../../../packages/contracts/src/index.ts'
import {
  actorIds,
  apiErrorRouteSchema,
  permissions
} from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { PolicySummaryPayload } from './summary.ts'

export type PolicyAuthorizeInput = {
  actor: ActorId
  action: Permission
  resource: string
  correlationId?: string
  traceId?: string
}

export type PolicyAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  authorize(input: PolicyAuthorizeInput): Promise<PolicyDecision>
  getDecision(id: string): Promise<PolicyDecision | null>
  getSummary(): Promise<PolicySummaryPayload>
}

const internalErrorSchema = apiErrorRouteSchema

const policyDecisionSchema = t.Object({
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

const policySummarySchema = t.Object({
  generatedAt: t.String(),
  decisions: t.Object({
    total: t.Number(),
    allow: t.Number(),
    deny: t.Number(),
    requireManualReview: t.Number(),
    requireMultiApproval: t.Number(),
    latestCreatedAt: t.Optional(t.String())
  }),
  recentDecisions: t.Array(
    t.Object({
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
      createdAt: t.String()
    })
  ),
  approvals: t.Object({
    total: t.Number(),
    pending: t.Number(),
    approved: t.Number(),
    rejected: t.Number(),
    expired: t.Number(),
    canceled: t.Number(),
    latestCreatedAt: t.Optional(t.String()),
    nextExpiryAt: t.Optional(t.String())
  }),
  pendingApprovals: t.Array(
    t.Object({
      approvalId: t.String(),
      policyDecisionId: t.String(),
      requestedBy: t.UnionEnum(actorIds),
      requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
      status: t.Literal('pending'),
      createdAt: t.String(),
      expiresAt: t.String()
    })
  )
})

/**
 * M-Policy 对内只暴露健康检查、授权决策和决策查询。
 * 每条 Elysia 链都先校验 internal token，再进入 trace 与领域逻辑。
 */
export function createPolicyApp(deps: PolicyAppDeps) {
  return new Elysia()
    .get('/health', () => ({ ok: true as const, service: 'm-policy' as const }))
    .get('/ready', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-policy', 'm-policy.ready', headers, () => deps.readiness())
    })
    .post(
      '/internal/v0/authorize',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        // 授权入口保持同步返回，Core 需要在继续写权威状态前拿到明确 allow/deny 结论。
        return withExtractedSpan('m-policy', 'm-policy.authorize', headers, async () => ({
          decision: await deps.authorize(body)
        }))
      },
      {
        body: t.Object({
          actor: t.UnionEnum(actorIds),
          action: t.UnionEnum(permissions),
          resource: t.String(),
          correlationId: t.Optional(t.String()),
          traceId: t.Optional(t.String())
        }),
        response: {
          200: t.Object({
            decision: policyDecisionSchema
          }),
          401: internalErrorSchema
        }
      }
    )
    .get(
      '/internal/v0/decisions/:id',
      async ({ params, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        // 决策查询只读既有事实，不在查询路径重跑授权计算，避免审计事实漂移。
        return withExtractedSpan('m-policy', 'm-policy.get-decision', headers, async () => {
          const decision = await deps.getDecision(params.id)
          return (
            decision ??
            status(404, {
              error: { code: 'policy.not_found', message: 'policy decision not found' }
            })
          )
        })
      },
      {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        response: {
          200: policyDecisionSchema,
          401: internalErrorSchema,
          404: internalErrorSchema
        }
      }
    )
    .get(
      '/internal/v0/summary',
      async ({ headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-policy', 'm-policy.get-summary', headers, () =>
          deps.getSummary()
        )
      },
      {
        response: {
          200: policySummarySchema,
          401: internalErrorSchema
        }
      }
    )
}

export type PolicyApp = ReturnType<typeof createPolicyApp>
