import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import type { MNetAppDeps } from './deps.ts'
import { verifyBearerAuth } from './route-helpers.ts'

type RouteSet = { status?: unknown }
type RouteFailure = {
  kind: 'failure'
  status: 400 | 401 | 403 | 404 | 503
  error: { code: string; message: string }
}

type DefaultsDeps = Pick<MNetAppDeps, 'globalDefaultsStore'> & {
  globalDefaultsStore: NonNullable<MNetAppDeps['globalDefaultsStore']>
}

type DefaultsWriteDeps = Pick<MNetAppDeps, 'globalDefaultsStore' | 'policyAuthorize'> & {
  globalDefaultsStore: NonNullable<MNetAppDeps['globalDefaultsStore']>
  policyAuthorize: NonNullable<MNetAppDeps['policyAuthorize']>
}

type MigrationDeps = Pick<MNetAppDeps, 'migrationEngine' | 'policyAuthorize'> & {
  migrationEngine: NonNullable<MNetAppDeps['migrationEngine']>
  policyAuthorize: NonNullable<MNetAppDeps['policyAuthorize']>
}

/**
 * 外部控制面 Bearer 校验统一收口，保持所有 global-defaults 写路径共享同一 401 语义。
 */
export function isGlobalDefaultsFailure(value: unknown): value is RouteFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: string }).kind === 'failure'
  )
}

function routeFailure(status: RouteFailure['status'], code: string, message: string): RouteFailure {
  return { kind: 'failure', status, error: { code, message } }
}

export async function requireGlobalDefaultsActor(
  headers: Record<string, string | undefined>,
  _set: RouteSet
): Promise<ActorId | RouteFailure> {
  const actor = await verifyBearerAuth(headers)
  if (!actor) {
    return routeFailure(401, 'auth.invalid_token', 'invalid or missing bearer token')
  }
  return actor
}

/**
 * 只读 defaults 依赖守卫；读接口不需要 policyAuthorize，但必须有 defaults store。
 */
export function requireDefaultsReadDeps(
  deps: Pick<MNetAppDeps, 'globalDefaultsStore'>,
  _set: RouteSet
): DefaultsDeps | RouteFailure {
  if (!deps.globalDefaultsStore) {
    return routeFailure(503, 'feature.unavailable', 'global defaults not available')
  }
  return { globalDefaultsStore: deps.globalDefaultsStore }
}

/**
 * defaults 写路径需要 defaults store + policyAuthorize，保持 503 错误语义与旧实现一致。
 */
export function requireDefaultsWriteDeps(
  deps: Pick<MNetAppDeps, 'globalDefaultsStore' | 'policyAuthorize'>,
  _set: RouteSet
): DefaultsWriteDeps | RouteFailure {
  if (!deps.globalDefaultsStore || !deps.policyAuthorize) {
    return routeFailure(503, 'feature.unavailable', 'global defaults not available')
  }
  return {
    globalDefaultsStore: deps.globalDefaultsStore,
    policyAuthorize: deps.policyAuthorize
  }
}

/**
 * batch migration 路由都依赖 migration engine + policyAuthorize，统一守卫能消掉四段重复 503 分支。
 */
export function requireMigrationDeps(
  deps: Pick<MNetAppDeps, 'migrationEngine' | 'policyAuthorize'>,
  _set: RouteSet
): MigrationDeps | RouteFailure {
  if (!deps.migrationEngine || !deps.policyAuthorize) {
    return routeFailure(503, 'feature.unavailable', 'batch migration not available')
  }
  return {
    migrationEngine: deps.migrationEngine,
    policyAuthorize: deps.policyAuthorize
  }
}

/**
 * M-Policy deny 在这一簇路由里都映射成 403 + policy.denied，只是前缀文案不同。
 */
export async function requireGlobalDefaultsPolicy(
  policyAuthorize: NonNullable<MNetAppDeps['policyAuthorize']>,
  input: {
    actor: string
    action: string
    resource: string
    deniedPrefix: string
    set: RouteSet
  }
): Promise<{ policyDecisionId: string } | RouteFailure> {
  const policyResult = await policyAuthorize.authorize(input.actor, input.action, input.resource)
  if (policyResult.result !== 'allow') {
    return routeFailure(
      403,
      'policy.denied',
      `${input.deniedPrefix} denied: ${policyResult.reasons.join(', ')}`
    )
  }
  return { policyDecisionId: policyResult.id }
}

/**
 * apply/resume/rollback 的 engine 结果都统一映射 operation_not_found，避免每条路由重复 unwrap。
 */
export function requireSwitchOperationResult<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
  _set: RouteSet
): T | RouteFailure {
  if (!result.ok) {
    return routeFailure(404, 'switch.operation_not_found', result.error)
  }
  return result.value
}
