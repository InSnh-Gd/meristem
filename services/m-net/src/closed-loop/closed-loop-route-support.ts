import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { ActorId } from '../../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from '../deps.ts'

export type ClosedLoopRouteContext = {
  actor: ActorId
  correlationId: string
  service: NonNullable<MNetAppDeps['closedLoop']>
}

export type ClosedLoopRouteFailure = {
  kind: 'failure'
  status: 400 | 401 | 503
  error: { code: string; message: string }
}

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

/** 路由鉴权只解析身份；policy、Audit 和 mutation 顺序由 closed-loop workflow 独占。 */
export async function requireClosedLoopRouteContext(
  deps: Pick<MNetAppDeps, 'auth' | 'closedLoop'>,
  headers: Record<string, string | undefined>
): Promise<ClosedLoopRouteContext | ClosedLoopRouteFailure> {
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    return {
      kind: 'failure',
      status: 401,
      error: { code: 'auth.invalid_token', message: 'invalid or missing bearer token' }
    }
  }
  const verified = await deps.auth.verify(token)
  if (!verified.ok) {
    return {
      kind: 'failure',
      status: 401,
      error: { code: verified.code, message: verified.message }
    }
  }
  if (!deps.closedLoop) {
    return {
      kind: 'failure',
      status: 503,
      error: { code: 'feature.unavailable', message: 'M-Net closed-loop service is unavailable' }
    }
  }
  const correlationId = headers['x-correlation-id']
  if (correlationId && !correlationIdPattern.test(correlationId)) {
    return {
      kind: 'failure',
      status: 400,
      error: {
        code: 'request.invalid_correlation_id',
        message: 'x-correlation-id must be 1-128 URL-safe identifier characters'
      }
    }
  }
  return {
    actor: verified.actor,
    correlationId: correlationId ?? `correlation-${crypto.randomUUID()}`,
    service: deps.closedLoop
  }
}
