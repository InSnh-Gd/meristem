import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { correlationIdFromHeader } from '../errors.ts'
import type { CoreDeps } from '../types.ts'

export type AuthContext = { actor: ActorId; correlationId: string }

/**
 * Core 所有受保护路由都先经过这一层 Bearer Token 解析与本地 JWT 校验，
 * 这样后续策略、审计和事件链路都能复用统一的 actor 与 correlationId。
 */
export async function requireActor(
  deps: CoreDeps,
  headers: Record<string, string | undefined>
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    throw new CoreError(401, 'auth.missing_token', 'Bearer token is required', correlationId)
  }
  const verified = await deps.auth.verify(token)
  if (!verified.ok) {
    const code = 'error' in verified ? verified.error.code : verified.code
    const message = 'error' in verified ? verified.error.message : verified.message

    // 当认证层能确认 actor 与 jti 且 token 已撤销时，先补写审计事实，再对外保持 401 fail-closed。
    if (
      code === 'identity.token.revoked' &&
      'actor' in verified &&
      typeof verified.actor === 'string' &&
      'jti' in verified &&
      typeof verified.jti === 'string'
    ) {
      await deps.log.writeAudit({
        actor: verified.actor as ActorId,
        action: 'identity:token-revoke',
        resource: `identity:token:${verified.jti}`,
        result: 'deny',
        correlationId,
        payload: {
          jti: verified.jti,
          reason: 'revoked_token_use_denied'
        }
      })
    }

    const status = code === 'identity.introspection.unavailable' ? 503 : 401
    throw new CoreError(status, code, message, correlationId)
  }
  const actor = 'value' in verified ? verified.value.actor : verified.actor
  return { actor, correlationId }
}

/**
 * Core 不直接做权限硬编码，而是统一委托给 M-Policy，并在这里集中处理
 * fail-closed、拒绝写 Full Log 以及对外 HTTP 错误映射。
 */
export async function authorize(
  deps: CoreDeps,
  input: { actor: ActorId; action: Permission; resource: string; correlationId: string }
) {
  const decision = await deps.policy.authorize(input)
  if (!decision.ok) {
    throw new CoreError(503, decision.error.code, decision.error.message, input.correlationId)
  }
  if (decision.value.result === 'deny') {
    await deps.log.writeFull({
      level: 'warn',
      source: 'meristem-core',
      message: `permission denied: ${input.action}`,
      correlationId: input.correlationId,
      payload: {
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        decisionId: decision.value.id
      }
    })
    throw new CoreError(403, 'policy.denied', 'permission denied', input.correlationId)
  }
  return decision.value
}
