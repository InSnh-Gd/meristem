import { addMilliseconds } from 'date-fns'
import type { MNetAppDeps } from './deps.ts'
import type { ProfileState } from './profile-state-machine.ts'

/** 中国区域控制面 Profile 版本。 */
export const CHINA_PROFILE_VERSION = 'm-net-cn@0.1.0'

/** 中国区域生产数据面 Profile 版本。 */
export const CHINA_DATA_PLANE_PROFILE_VERSION = 'm-net-cn@0.2.0'

/** 默认 Profile 版本，disable 回退目标版本。 */
export const DEFAULT_PROFILE_VERSION = 'm-net-default@0.1.0'

/** 挂起审批操作的有效期（30 分钟）。 */
export const REQUEST_TTL_MS = 30 * 60 * 1000

/** Elysia set 对象的最小类型约束。 */
export type RouteSet = { status?: unknown }

export type ProfileWriteBody = {
  profileVersion:
    | typeof CHINA_PROFILE_VERSION
    | typeof CHINA_DATA_PLANE_PROFILE_VERSION
    | typeof DEFAULT_PROFILE_VERSION
  reason: string
}

export type BreakGlassBody = {
  emergencyReason: string
  approvalDegraded?: boolean
}

export type ProfileStore = NonNullable<MNetAppDeps['profileStore']>
export type PolicyAuthorize = NonNullable<MNetAppDeps['policyAuthorize']>
export type SuspendedOps = NonNullable<MNetAppDeps['suspendedOps']>
export type Approvals = NonNullable<MNetAppDeps['approvals']>
export type ProfileDisablePolicy = NonNullable<MNetAppDeps['profileDisablePolicy']>

export type ProfileReadDeps = {
  profileStore: ProfileStore
  policyAuthorize: PolicyAuthorize
}

export type ProfileWriteDeps = ProfileReadDeps & {
  suspendedOps: SuspendedOps
  approvals: Approvals
  events?: MNetAppDeps['events']
  log?: MNetAppDeps['log']
  profileDisablePolicy?: MNetAppDeps['profileDisablePolicy']
  networkUpdater?: MNetAppDeps['networkUpdater']
  listMembers?: MNetAppDeps['listMembers']
  migrationEngine?: MNetAppDeps['migrationEngine']
  dataPlane?: MNetAppDeps['dataPlane']
}

export type BreakGlassDeps = {
  profileStore: ProfileStore
  policyAuthorize: PolicyAuthorize
  profileDisablePolicy: ProfileDisablePolicy
  policyHealthCheck?: MNetAppDeps['policyHealthCheck']
  events?: MNetAppDeps['events']
  log?: MNetAppDeps['log']
  networkUpdater?: MNetAppDeps['networkUpdater']
  listMembers?: MNetAppDeps['listMembers']
  dataPlane?: MNetAppDeps['dataPlane']
}

export type StoredNetworkState = Awaited<ReturnType<ProfileStore['getNetworkState']>>
export type KnownNetworkState = NonNullable<StoredNetworkState> & { status: ProfileState }

/** Support helper 的显式 tagged failure，避免 never-shortcircuit 模式。 */
export type ProfileWorkflowFailure = {
  kind: 'failure'
  status: 400 | 401 | 403 | 404 | 409 | 503
  error: { code: string; message: string }
}

/** 将未知状态字符串收窄为 ProfileState，非法值返回 null。 */
export function profileStateFrom(status: string): ProfileState | null {
  switch (status) {
    case 'disabled':
    case 'enabling':
    case 'enabled':
    case 'disabling':
    case 'failed':
      return status
    default:
      return null
  }
}

/** 将存储层状态收窄为 KnownNetworkState，未知状态返回 null。 */
export function toKnownState(state: StoredNetworkState): KnownNetworkState | null {
  if (!state) return null
  const knownStatus = profileStateFrom(state.status)
  return knownStatus ? { ...state, status: knownStatus } : null
}

/** 生成从当前时间起 30 分钟后的 ISO 时间戳。 */
export function expiresAtFromNow(): string {
  return addMilliseconds(new Date(), REQUEST_TTL_MS).toISOString()
}

/** 生成新的 correlationId。 */
export function correlationId(): string {
  return crypto.randomUUID()
}

/** 判断返回值是否为 tagged failure。 */
export function isProfileWorkflowFailure(value: unknown): value is ProfileWorkflowFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: string }).kind === 'failure'
  )
}

/** 构造 tagged failure。 */
export function profileWorkflowFailure(
  status: ProfileWorkflowFailure['status'],
  code: string,
  message: string
): ProfileWorkflowFailure {
  return { kind: 'failure', status, error: { code, message } }
}
