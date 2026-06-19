import { serviceUrl, warnDegradedAndReturn } from '../../../packages/internal-http/src/index.ts'

export type ApprovalClient = {
  create(input: {
    policyDecisionId: string
    originService: string
    operationId: string
    requestedBy: string
    requiredAction: string
    quorumRequired: number
    expiresAt: string
  }): Promise<
    | { ok: true; value: { approvalId: string } }
    | { ok: false; error: { code: string; message: string } }
  >
}

export type PolicyAuthorize = {
  authorize(
    actor: string,
    action: string,
    resource: string
  ): Promise<{
    result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
    id: string
    reasons: string[]
  }>
}

function readApprovalBody(value: unknown): { code: string; message: string } {
  if (typeof value !== 'object' || value === null) {
    return { code: 'approval.create_failed', message: 'failed to create approval' }
  }
  const error =
    'error' in value && typeof value.error === 'object' && value.error !== null ? value.error : null
  const code =
    error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'approval.create_failed'
  const message =
    error && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'failed to create approval'
  return { code, message }
}

function readApprovalSuccess(value: unknown): { approvalId: string } | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('approval' in value) || typeof value.approval !== 'object' || value.approval === null) {
    return null
  }
  if (!('id' in value.approval) || typeof value.approval.id !== 'string') return null
  return { approvalId: value.approval.id }
}

function readPolicyDecision(value: unknown): {
  result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  id: string
  reasons: string[]
} | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('decision' in value) || typeof value.decision !== 'object' || value.decision === null) {
    return null
  }
  const decision = value.decision
  if (!('result' in decision) || typeof decision.result !== 'string') return null
  if (!('id' in decision) || typeof decision.id !== 'string') return null
  if (!('reasons' in decision) || !Array.isArray(decision.reasons)) return null
  if (
    !['allow', 'deny', 'require_manual_review', 'require_multi_approval'].includes(decision.result)
  ) {
    return null
  }
  let result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  switch (decision.result) {
    case 'allow':
    case 'deny':
    case 'require_manual_review':
    case 'require_multi_approval':
      result = decision.result
      break
    default:
      return null
  }
  return {
    result,
    id: decision.id,
    reasons: decision.reasons.filter((reason): reason is string => typeof reason === 'string')
  }
}

export function createApprovalClient(fetcher: typeof fetch): ApprovalClient {
  return {
    /**
     * 审批创建通过 M-Policy internal HTTP 边界完成；降级路径返回结构化错误，不在入口层吞掉失败原因。
     */
    async create(input) {
      try {
        const response = await fetcher(`${serviceUrl('m-policy')}/internal/v0/policy/approvals`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input)
        })
        if (!response.ok) {
          const body = await response.json().catch(error => {
            warnDegradedAndReturn({
              service: 'm-net',
              target: 'approval error response parse',
              error,
              context: 'degraded',
              fallback: undefined,
              warn: ({ message }) => console.warn(message)
            })
            return {}
          })
          return {
            ok: false,
            error: readApprovalBody(body)
          }
        }

        const parsed = readApprovalSuccess(await response.json())
        if (!parsed) {
          return {
            ok: false,
            error: { code: 'approval.create_failed', message: 'invalid approval response' }
          }
        }
        return { ok: true, value: parsed }
      } catch (error: unknown) {
        warnDegradedAndReturn({
          service: 'm-net',
          target: 'approval create request',
          error,
          context: 'degraded',
          fallback: undefined,
          warn: ({ message }) => console.warn(message)
        })
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: { code: 'approval.create_failed', message } }
      }
    }
  }
}

export function createPolicyAuthorizeClient(fetcher: typeof fetch): PolicyAuthorize {
  return {
    /**
     * M-Policy 不可用时必须 fail-closed，保持高风险控制面操作默认拒绝。
     */
    async authorize(actor, action, resource) {
      try {
        const response = await fetcher(`${serviceUrl('m-policy')}/internal/v0/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actor, action, resource })
        })
        if (!response.ok) {
          return {
            result: 'deny' as const,
            id: crypto.randomUUID(),
            reasons: ['policy service unavailable']
          }
        }
        const parsed = readPolicyDecision(await response.json())
        if (!parsed) {
          return {
            result: 'deny' as const,
            id: crypto.randomUUID(),
            reasons: ['invalid policy decision response']
          }
        }
        return parsed
      } catch (error: unknown) {
        warnDegradedAndReturn({
          service: 'm-net',
          target: 'policy authorize request',
          error,
          context: 'degraded',
          fallback: undefined,
          warn: ({ message }) => console.warn(message)
        })
        return {
          result: 'deny' as const,
          id: crypto.randomUUID(),
          reasons: ['policy service unreachable']
        }
      }
    }
  }
}
