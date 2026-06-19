import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import type { MNetAppDeps } from './deps.ts'
import { CHINA_DATA_PLANE_PROFILE_VERSION } from './mnet-dataplane-workflows.ts'
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

type GlobalDefaultsWriteRuntimeDeps = {
  globalDefaultsStore: NonNullable<MNetAppDeps['globalDefaultsStore']>
  profileStore: MNetAppDeps['profileStore'] | undefined
  migrationEngine: MNetAppDeps['migrationEngine'] | undefined
  log: MNetAppDeps['log'] | undefined
  events: MNetAppDeps['events'] | undefined
}

type SetDefaultsSuccess = {
  operationId: string
  policyDecisionId: string
  auditId: string
  defaultProfileVersion: string
  migrationOperationId?: string
}

type SetDefaultsPreflight =
  | { kind: 'continue' }
  | { kind: 'success'; value: SetDefaultsSuccess }
  | RouteFailure

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
 * migration 路由都共享同一套 actor + deps + policy unwrap；收在这里避免每条 handler 重复 fail-closed 样板。
 */
export async function requireAuthorizedMigrationContext(
  deps: Pick<MNetAppDeps, 'migrationEngine' | 'policyAuthorize'>,
  input: {
    headers: Record<string, string | undefined>
    set: RouteSet
    action: string
    resource: string
    deniedPrefix: string
  }
): Promise<{ actor: ActorId; migrationDeps: MigrationDeps } | RouteFailure> {
  const actor = await requireGlobalDefaultsActor(input.headers, input.set)
  if (isGlobalDefaultsFailure(actor)) return actor

  const migrationDeps = requireMigrationDeps(deps, input.set)
  if (isGlobalDefaultsFailure(migrationDeps)) return migrationDeps

  const policy = await requireGlobalDefaultsPolicy(migrationDeps.policyAuthorize, {
    actor,
    action: input.action,
    resource: input.resource,
    deniedPrefix: input.deniedPrefix,
    set: input.set
  })
  if (isGlobalDefaultsFailure(policy)) return policy

  return { actor, migrationDeps }
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

async function applyPlannedMigration(
  migrationEngine: NonNullable<MNetAppDeps['migrationEngine']>,
  operationId: string,
  actor: string
) {
  while (true) {
    const status = await migrationEngine.getStatus(operationId)
    if (!status.ok) return
    if (status.value.completedBatchIds.length >= status.value.batches.length) return
    const applied = await migrationEngine.apply(operationId, actor)
    if (!applied.ok || applied.value.isComplete) return
  }
}

/**
 * PUT /profile-defaults 的原始语义是：先命中幂等缓存/版本校验，再做 policy。
 * ponytail: 只把这一段预检单独抽出来，恢复行为顺序，不回退整块 support 下沉。
 */
export async function preflightSetGlobalDefaultProfile(
  deps: Pick<GlobalDefaultsWriteRuntimeDeps, 'globalDefaultsStore' | 'profileStore'>,
  input: { profileVersion: string; idempotencyKey: string }
): Promise<SetDefaultsPreflight> {
  const existingResult = await deps.globalDefaultsStore.getDefaultSetResultByIdempotencyKey(
    input.idempotencyKey
  )
  if (existingResult) {
    return {
      kind: 'success',
      value: {
        operationId: existingResult.operationId,
        policyDecisionId: existingResult.policyDecisionId,
        auditId: existingResult.auditId,
        defaultProfileVersion: existingResult.defaultProfileVersion ?? input.profileVersion,
        ...(existingResult.migrationOperationId
          ? { migrationOperationId: existingResult.migrationOperationId }
          : {})
      }
    }
  }

  const defs = deps.profileStore ? await deps.profileStore.getDefinitions() : []
  const validDef = defs.find(definition => definition.profileVersion === input.profileVersion)
  if (!validDef) {
    return routeFailure(
      400,
      'profile.not_found',
      `unknown profile version: ${input.profileVersion}`
    )
  }

  return { kind: 'continue' }
}

export async function setGlobalDefaultProfile(
  deps: GlobalDefaultsWriteRuntimeDeps,
  input: {
    actor: string
    policyDecisionId: string
    profileVersion: string
    reason: string
    idempotencyKey: string
  }
): Promise<SetDefaultsSuccess | RouteFailure> {
  const preflight = await preflightSetGlobalDefaultProfile(deps, {
    profileVersion: input.profileVersion,
    idempotencyKey: input.idempotencyKey
  })
  if (preflight.kind === 'success') {
    return preflight.value
  }
  if (isGlobalDefaultsFailure(preflight)) {
    return preflight
  }

  const correlationId = crypto.randomUUID()
  const auditId = crypto.randomUUID()

  await deps.globalDefaultsStore.setDefaultProfileVersion(input.profileVersion)

  let migrationOperationId: string | undefined
  if (input.profileVersion === CHINA_DATA_PLANE_PROFILE_VERSION && deps.migrationEngine) {
    const plan = await deps.migrationEngine.plan({
      targetProfileVersion: input.profileVersion,
      batchSize: 10,
      reason: input.reason,
      idempotencyKey: `defaults:${input.idempotencyKey}:${input.profileVersion}`
    })
    if (plan.ok && plan.value.candidateCount > 0) {
      migrationOperationId = plan.value.operationId
      await applyPlannedMigration(deps.migrationEngine, plan.value.operationId, input.actor)
    }
  }

  const responseBody: SetDefaultsSuccess = {
    operationId: correlationId,
    policyDecisionId: input.policyDecisionId,
    auditId,
    defaultProfileVersion: input.profileVersion,
    ...(migrationOperationId ? { migrationOperationId } : {})
  }

  await deps.globalDefaultsStore.recordDefaultSetResult(input.idempotencyKey, responseBody)

  await deps.log?.writeTimeline(
    `global default profile set to ${input.profileVersion}`,
    'mnet.profile.defaults.set',
    correlationId
  )
  await deps.log?.writeFull(
    'info',
    `global default profile set to ${input.profileVersion} by ${input.actor}`,
    correlationId,
    {
      profileVersion: input.profileVersion,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey
    }
  )
  await deps.log?.writeAudit(
    input.actor,
    'mnet.profile.defaults.set',
    'network:profile-defaults',
    'success',
    auditId,
    { profileVersion: input.profileVersion, reason: input.reason }
  )
  await deps.events?.publish(
    'mnet.profile.defaults.updated.v0',
    'mnet.profile.defaults.updated',
    {
      defaultProfileVersion: input.profileVersion,
      actor: input.actor,
      reason: input.reason,
      correlationId,
      controlPlaneOnly: input.profileVersion !== CHINA_DATA_PLANE_PROFILE_VERSION,
      ...(migrationOperationId ? { migrationOperationId } : {})
    },
    correlationId
  )

  return responseBody
}
