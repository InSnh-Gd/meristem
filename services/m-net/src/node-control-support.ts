import type { ActorId } from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import { verifyBearerAuth } from './route-helpers.ts'

export type NodeControlRouteFailure = {
  status: 401 | 503
  code: string
  message: string
}

export type NodeControlRouteContext = {
  actor: ActorId
  controlNode: NonNullable<MNetAppDeps['controlNode']>
}

/**
 * 节点控制外部路由统一做 JWT actor 校验与依赖存在性守卫，避免 handler 内重复样板逻辑。
 */
export async function requireAuthorizedNodeControlContext(
  deps: Pick<MNetAppDeps, 'controlNode'>,
  headers: Record<string, string | undefined>
): Promise<NodeControlRouteContext | NodeControlRouteFailure> {
  const actor = await verifyBearerAuth(headers)
  if (!actor) {
    return {
      status: 401,
      code: 'auth.invalid_token',
      message: 'invalid or missing bearer token'
    }
  }

  if (!deps.controlNode) {
    return {
      status: 503,
      code: 'feature.unavailable',
      message: 'node control features are not available'
    }
  }

  return { actor, controlNode: deps.controlNode }
}
