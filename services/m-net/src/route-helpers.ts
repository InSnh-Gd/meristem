import { extractBearerToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import type { MNetServiceError } from './types.ts'

/**
 * internal HTTP 所有入口统一复用共享 token 校验，避免 Core -> M-Net 的 loopback 调用分散出多套认证逻辑。
 */
export function requireInternal<TStatus extends (code: never, body: never) => unknown>(
  headers: Headers | Record<string, string | undefined>,
  _status: TStatus
): never | null {
  const auth = validateInternalRequest(headers)
  return auth.ok
    ? null
    : (_status(
        401 as Parameters<TStatus>[0],
        { error: auth.error } as Parameters<TStatus>[1]
      ) as never)
}

export function internalError<TStatus extends (code: never, body: never) => unknown>(
  _status: TStatus,
  code: 404 | 409 | 503,
  errorBody: MNetServiceError
): never {
  return _status(
    code as Parameters<TStatus>[0],
    { error: errorBody } as Parameters<TStatus>[1]
  ) as never
}

/**
 * 从 Bearer token 提取并验证 JWT actor，用于外部 /api/v0 路由。
 * 返回 null 表示认证失败，调用方必须返回 401。
 */
export async function verifyBearerAuth(
  headers: Record<string, string | undefined>
): Promise<ActorId | null> {
  const token = extractBearerToken(headers.authorization)
  if (!token) return null
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) return null
  const verified = await verifyLocalToken({ token, secret })
  if (!verified.ok) return null
  return verified.actor
}

/**
 * 外部 API 路由统一错误出口，使用 set.status 设置 HTTP 状态码并返回 never 类型，
 * 让 TypeScript 可以正确将错误分支与非错误分支的返回类型统一。
 */
export function externalApiError(
  set: { status?: unknown },
  code: 400 | 401 | 403 | 404 | 409 | 503,
  who: string,
  message: string
): never {
  set.status = code
  return { error: { code: who, message } } as never
}

/**
 * M-Net 业务错误在内部 HTTP 面收敛成稳定状态码，方便 Core 继续沿用统一错误映射策略。
 */
export function statusCodeForMNetError(code: string): 404 | 409 | 503 {
  switch (code) {
    case 'network.not_found':
    case 'node.not_found':
    case 'task.not_found':
      return 404
    case 'network.conflict':
    case 'network_map.stale':
    case 'network_map.expired':
    case 'network.stem_required':
    case 'key.invalid':
    case 'key.duplicate':
    case 'node.invalid_kind':
    case 'node.invalid_status':
    case 'node.unreachable':
    case 'node.stale_session':
    case 'node.join_ticket_expired':
    case 'node.join_ticket_redeemed':
    case 'node.join_ticket_revoked':
      return 409
    default:
      return 503
  }
}
