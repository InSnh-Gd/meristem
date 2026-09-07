import type { PolicyAuthorize } from './profile-workflow-types.ts'

/**
 * M-Policy 授权的统一 403 收敛点。
 *
 * 各 workflow 曾复制 `profileWorkflowFailure(403, 'policy.denied', …)` / `routeFailure` /
 * `nodeControlFailure` 样板；本模块统一 authorize 调用与拒绝消息格式，调用方只负责把
 * denied 结果包装成各自的 failure envelope，wire 行为保持不变：
 * `403 + policy.denied + `${prefix} denied: ${reasons.join(', ')}``。
 */

export type PolicyGuardAllow = {
  kind: 'allowed'
  /** 原始 policy result；deny-only 模式下可能是 require_manual_review / require_multi_approval。 */
  result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  policyDecisionId: string
}

export type PolicyGuardDeny = {
  kind: 'denied'
  status: 403
  code: 'policy.denied'
  message: string
  policyDecisionId: string
  reasons: string[]
}

export type PolicyGuardResult = PolicyGuardAllow | PolicyGuardDeny

export async function authorizeOr403(
  policyAuthorize: PolicyAuthorize,
  input: {
    actor: string
    action: string
    resource: string
    /** 拒绝消息前缀，如 'profile enable'；最终消息为 `${prefix} denied: …`。 */
    deniedPrefix: string
    /**
     * deny-only：仅显式 deny 拒绝，manual_review / multi_approval 继续走审批流。
     * non-allow：非 allow 一律拒绝（立即执行路径）。
     */
    denyOn: 'deny-only' | 'non-allow'
  }
): Promise<PolicyGuardResult> {
  const policyResult = await policyAuthorize.authorize(input.actor, input.action, input.resource)
  const denied =
    input.denyOn === 'deny-only' ? policyResult.result === 'deny' : policyResult.result !== 'allow'
  if (denied) {
    return {
      kind: 'denied',
      status: 403,
      code: 'policy.denied',
      message: `${input.deniedPrefix} denied: ${policyResult.reasons.join(', ')}`,
      policyDecisionId: policyResult.id,
      reasons: [...policyResult.reasons]
    }
  }
  return { kind: 'allowed', result: policyResult.result, policyDecisionId: policyResult.id }
}
