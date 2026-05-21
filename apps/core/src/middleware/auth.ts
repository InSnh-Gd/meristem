import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { apiError, correlationIdFromHeader } from '../errors.ts'
import type { StatusFn } from '../errors.ts'
import type { CoreDeps } from '../types.ts'

export type AuthContext =
  | { ok: true; actor: ActorId; correlationId: string }
  | { ok: false; response: never }

/**
 * Core 所有受保护路由都先经过这一层 Bearer Token 解析与本地 JWT 校验，
 * 这样后续策略、审计和事件链路都能复用统一的 actor 与 correlationId。
 */
export async function requireActor<TStatus extends StatusFn>(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  status: TStatus
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    return { ok: false, response: apiError(status, 401, 'auth.missing_token', 'Bearer token is required', correlationId) }
  }
  const verified = await deps.auth.verify(token)
  if (!verified.ok) {
    const code = 'error' in verified ? verified.error.code : verified.code
    const message = 'error' in verified ? verified.error.message : verified.message
    return { ok: false, response: apiError(status, 401, code, message, correlationId) }
  }
  const actor = 'value' in verified ? verified.value.actor : verified.actor
  return { ok: true, actor, correlationId }
}

/**
 * Core 不直接做权限硬编码，而是统一委托给 M-Policy，并在这里集中处理
 * fail-closed、拒绝写 Full Log 以及对外 HTTP 错误映射。
 */
export async function authorize<TStatus extends StatusFn>(
  deps: CoreDeps,
  input: { actor: ActorId; action: Permission; resource: string; correlationId: string },
  status: TStatus
) {
  const decision = await deps.policy.authorize(input)
  if (!decision.ok) {
    return {
      ok: false as const,
      response: apiError(status, 503, decision.error.code, decision.error.message, input.correlationId)
    }
  }
  if (decision.value.result === 'deny') {
    await deps.log.writeFull({
      level: 'warn',
      source: 'meristem-core',
      message: `permission denied: ${input.action}`,
      correlationId: input.correlationId,
      payload: { actor: input.actor, action: input.action, resource: input.resource, decisionId: decision.value.id }
    })
    return {
      ok: false as const,
      response: apiError(status, 403, 'policy.denied', 'permission denied', input.correlationId)
    }
  }
  return { ok: true as const, decision: decision.value }
}
