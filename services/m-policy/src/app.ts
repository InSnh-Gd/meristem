import { Elysia, t } from 'elysia'
import type { ActorId, Permission, PolicyDecision } from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

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
}

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
          actor: t.Union([
            t.Literal('viewer'),
            t.Literal('operator'),
            t.Literal('admin'),
            t.Literal('security-admin')
          ]),
          action: t.Union([
            t.Literal('core:read'),
            t.Literal('node:register'),
            t.Literal('node:issue-token'),
            t.Literal('task:assign'),
            t.Literal('timeline:read'),
            t.Literal('log:read-full'),
            t.Literal('audit:read'),
            t.Literal('service:register'),
            t.Literal('service:reload'),
            t.Literal('network:read'),
            t.Literal('network:create'),
            t.Literal('network:join')
          ]),
          resource: t.String(),
          correlationId: t.Optional(t.String()),
          traceId: t.Optional(t.String())
        })
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
          return decision ?? status(404, { error: { code: 'policy.not_found', message: 'policy decision not found' } })
        })
      },
      {
        params: t.Object({
          id: t.String({ minLength: 1 })
        })
      }
    )
}

export type PolicyApp = ReturnType<typeof createPolicyApp>
