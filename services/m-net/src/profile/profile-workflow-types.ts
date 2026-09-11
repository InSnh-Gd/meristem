import { addMilliseconds } from 'date-fns'
import type {
  MNetMigrationRequired,
  MNetworkMember,
  NetworkSuspendedOperation
} from '../../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from '../data-plane/data-plane-store-types.ts'
import type { NetBirdResolvedControlPlaneConfig } from '../data-plane/netbird-adapter.ts'
import type { MigrationEngine } from '../migration/migration-engine-contract.ts'
import type { ProfileDisablePolicyStore } from './profile-disable-policy.ts'
import type { ProfileState } from './profile-state-machine.ts'
import type { ProfileStore } from './profile-store.ts'

/** 中国区域默认启用的 NetBird Profile 版本。 */
export const CHINA_PROFILE_VERSION = 'm-net-cn@0.3.0'

/** 中国区域生产数据面 Profile 版本。 */
export const CHINA_DATA_PLANE_PROFILE_VERSION = 'm-net-cn@0.3.0'

/** 默认 Profile 版本，disable 回退目标版本。 */
export const DEFAULT_PROFILE_VERSION = 'm-net@0.3.0'

/** 默认 NetBird 迁移目标 Profile 版本。 */
export const V03_PROFILE_VERSION = 'm-net@0.3.0'

/** 中国区域 NetBird 迁移目标 Profile 版本。 */
export const V03_CN_PROFILE_VERSION = 'm-net-cn@0.3.0'

/** 挂起审批操作的有效期（30 分钟）。 */
export const REQUEST_TTL_MS = 30 * 60 * 1000

/** Elysia set 对象的最小类型约束。 */
export type RouteSet = { status?: unknown }

export type ProfileWriteBody = {
  profileVersion: typeof CHINA_PROFILE_VERSION | typeof DEFAULT_PROFILE_VERSION
  reason: string
}

export type BreakGlassBody = {
  emergencyReason: string
  approvalDegraded?: boolean
}

export type { ProfileStore } from './profile-store.ts'

// 这些依赖形状改为引用各自权威模块的类型，而非从 deps.ts 的 MNetAppDeps 派生——
// 后者会让本文件反向依赖 deps.ts，正是 DFW-041 依赖环的一环。
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
export type SuspendedOps = {
  create(input: {
    policyDecisionId: string
    action: string
    networkId: string
    fromProfileVersion: string
    toProfileVersion: string
    requestedBy: string
    reason?: string
    correlationId: string
    idempotencyKey: string
    expiresAt: string
  }): Promise<NetworkSuspendedOperation>
  get(id: string): Promise<NetworkSuspendedOperation | null>
  transition(
    id: string,
    status: string,
    terminalReason?: string
  ): Promise<NetworkSuspendedOperation | null>
}
export type Approvals = {
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
export type ProfileEvents = {
  publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
}
export type ProfileLog = {
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(
    level: string,
    message: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
  writeAudit(
    actor: string,
    action: string,
    resource: string,
    result: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
}
export type NetworkUpdater = {
  setProfileVersion(networkId: string, profileVersion: string): Promise<void>
}
export type ListMembers = (input: {
  networkId: string
}) => Promise<
  { ok: true; value: MNetworkMember[] } | { ok: false; error: { code: string; message: string } }
>
export type PolicyHealthCheck = { checkHealth(): Promise<{ healthy: boolean }> }

export type ProfileReadDeps = {
  profileStore: ProfileStore
  policyAuthorize: PolicyAuthorize
}

export type ProfileWriteDeps = ProfileReadDeps & {
  suspendedOps: SuspendedOps
  approvals: Approvals
  events?: ProfileEvents
  log?: ProfileLog
  profileDisablePolicy?: ProfileDisablePolicyStore
  networkUpdater?: NetworkUpdater
  listMembers?: ListMembers
  migrationEngine?: MigrationEngine
  dataPlane?: DataPlaneStores
  resolveNetBirdControlPlane?: (input: {
    networkId: string
    profileVersion: 'm-net@0.3.0' | 'm-net-cn@0.3.0'
  }) => Promise<NetBirdResolvedControlPlaneConfig | null>
}

export type BreakGlassDeps = {
  profileStore: ProfileStore
  policyAuthorize: PolicyAuthorize
  profileDisablePolicy: ProfileDisablePolicyStore
  policyHealthCheck?: PolicyHealthCheck
  events?: ProfileEvents
  log?: ProfileLog
  networkUpdater?: NetworkUpdater
  listMembers?: ListMembers
  dataPlane?: DataPlaneStores
}

export type StoredNetworkState = Awaited<ReturnType<ProfileStore['getNetworkState']>>
export type KnownNetworkState = NonNullable<StoredNetworkState> & { status: ProfileState }

/** Support helper 的显式 tagged failure，避免 never-shortcircuit 模式。 */
export type ProfileWorkflowFailure = {
  kind: 'failure'
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 503
  error: { code: string; message: string; migration?: MNetMigrationRequired }
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
  return { kind: 'failure', ok: false, status, error: { code, message } }
}
