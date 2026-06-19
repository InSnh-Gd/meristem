import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import type { NetworkMapFromSchema as NetworkMap } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type {
  MNetPartitionState,
  MNetProfileVersion,
  MNetRegionalProfile,
  MNetRelayType,
  MNetTunnelStatus,
  NetworkSuspendedOperation,
  NetworkSuspendedOperationStatus
} from '../../../packages/contracts/src/types/mnet-profile.ts'
import type { StoredNodePublicKey } from './data-plane-store-types.ts'
import type {
  NetworkOperationLock,
  NetworkOperationType,
  OperationLockStatus
} from './operation-locks.ts'
import type {
  NetworkPartitionState,
  NetworkPartitionStatus,
  PartitionTransitionReason
} from './partition-state.ts'

/**
 * 断言未知值为对象记录；失败时返回 null，供存储层走显式降级路径。
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * 将布尔值编码为 PostgreSQL 文本，避免在 schema 层引入额外布尔迁移分支。
 */
export function encodeBoolean(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false'
}

/**
 * 将 PostgreSQL 文本布尔还原为运行时布尔；未知值一律按 false 处理。
 */
export function decodeBoolean(value: string): boolean {
  return value === 'true'
}

/**
 * 把日期列统一编码为 ISO 字符串，避免各 store 重复判断 null/undefined。
 */
export function toIsoString(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined
}

/**
 * 将 JSON 列解析为 M-Net 区域 Profile；字段不完整时返回 null，避免把脏数据注入服务层。
 */
export function decodeRegionalProfile(value: unknown): MNetRegionalProfile | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.profileVersion !== 'string') return null
  if (typeof record.region !== 'string') return null
  if (typeof record.displayName !== 'string') return null
  if (typeof record.schemaVersion !== 'string') return null
  if (typeof record.status !== 'string') return null
  return value as MNetRegionalProfile
}

/**
 * 将 JSON 列解析为 NetworkMap；失败时返回 null，由调用方决定是否忽略坏记录。
 */
export function decodeNetworkMap(value: unknown): NetworkMap | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.networkId !== 'string') return null
  if (!Array.isArray(record.members)) return null
  if (!Array.isArray(record.aclRules)) return null
  if (typeof record.mapVersion !== 'number') return null
  if (typeof record.expiresAt !== 'number') return null
  return value as NetworkMap
}

/**
 * 将 JSON 解析为分区状态原因对象；未知结构返回 null，避免伪造状态机输入。
 */
export function decodePartitionReason(value: unknown): PartitionTransitionReason | null {
  const record = asRecord(value)
  if (!record || typeof record.code !== 'string') return null
  return value as PartitionTransitionReason
}

/**
 * 通过持久化字段重建节点公钥记录。
 */
export function buildStoredNodePublicKey(input: {
  nodeId: string
  keyId: string
  publicKey: string
  fingerprint: string
  algorithm: string
  createdAt: Date
  rotatedAt: Date | null
  rotationCounter: number
  rotationDueAt: Date | null
  status: string
}): StoredNodePublicKey | null {
  if (input.algorithm !== 'wireguard-x25519') return null
  return {
    nodeId: input.nodeId,
    keyId: input.keyId,
    publicKey: input.publicKey,
    fingerprint: input.fingerprint,
    algorithm: 'wireguard-x25519',
    createdAt: input.createdAt.toISOString(),
    ...(input.rotatedAt ? { rotatedAt: input.rotatedAt.toISOString() } : {}),
    rotationCounter: input.rotationCounter,
    ...(input.rotationDueAt ? { rotationDueAt: input.rotationDueAt.toISOString() } : {}),
    status: input.status
  }
}

/**
 * 校验并收窄挂起操作 action 字段，避免生产代码使用任意字符串断言。
 */
export function asSuspendedAction(value: string): NetworkSuspendedOperation['action'] | null {
  return value === 'mnet.profile.enable' || value === 'mnet.profile.disable' ? value : null
}

/**
 * 校验并收窄挂起操作状态字段。
 */
export function asSuspendedStatus(value: string): NetworkSuspendedOperationStatus | null {
  return ['suspended', 'resumed', 'rejected', 'expired', 'resume_failed'].includes(value)
    ? (value as NetworkSuspendedOperationStatus)
    : null
}

/**
 * 校验并收窄 actor 字段；未知 actor 直接拒绝解码。
 */
export function asActorId(value: string): ActorId | null {
  return ['viewer', 'operator', 'admin', 'security-admin'].includes(value)
    ? (value as ActorId)
    : null
}

/**
 * 校验并收窄 M-Net profile 版本。
 */
export function asProfileVersion(value: string): MNetProfileVersion | null {
  return ['m-net-default@0.1.0', 'm-net-cn@0.1.0', 'm-net-cn@0.2.0'].includes(value)
    ? (value as MNetProfileVersion)
    : null
}

/**
 * 校验并收窄 relay 类型。
 */
export function asRelayType(value: string): MNetRelayType | null {
  return ['direct', 'wstunnel', 'wstunnel_fallback'].includes(value)
    ? (value as MNetRelayType)
    : null
}

/**
 * 校验并收窄隧道状态。
 */
export function asTunnelStatus(value: string): MNetTunnelStatus | null {
  return ['up', 'down', 'degraded'].includes(value) ? (value as MNetTunnelStatus) : null
}

/**
 * 校验并收窄数据面操作类型。
 */
export function asOperationType(value: string): NetworkOperationType | null {
  return ['migration', 'apply', 'break_glass', 'rotation'].includes(value)
    ? (value as NetworkOperationType)
    : null
}

/**
 * 校验并收窄数据面操作锁状态。
 */
export function asOperationLockStatus(value: string): OperationLockStatus | null {
  return ['active', 'released', 'interrupted', 'expired'].includes(value)
    ? (value as OperationLockStatus)
    : null
}

/**
 * 校验并收窄契约暴露的分区状态。
 */
export function asContractPartitionState(value: string): MNetPartitionState | null {
  return ['connected', 'partitioned', 'unknown'].includes(value)
    ? (value as MNetPartitionState)
    : null
}

/**
 * 校验并收窄内部持久化分区状态。
 */
export function asPartitionStatus(value: string): NetworkPartitionStatus | null {
  return ['connected', 'stale', 'fail_closed', 'recovered'].includes(value)
    ? (value as NetworkPartitionStatus)
    : null
}

/**
 * 根据持久化字段重建完整挂起操作对象；任何关键字段非法都返回 null。
 */
export function buildSuspendedOperation(input: {
  id: string
  policyDecisionId: string
  action: string
  networkId: string
  fromProfileVersion: string
  toProfileVersion: string
  requestedBy: string
  reason: string | null
  correlationId: string
  idempotencyKey: string
  status: string
  expiresAt: Date
  createdAt: Date
  resumedAt: Date | null
  terminalReason: string | null
}): NetworkSuspendedOperation | null {
  const action = asSuspendedAction(input.action)
  const status = asSuspendedStatus(input.status)
  const requestedBy = asActorId(input.requestedBy)
  const fromProfileVersion = asProfileVersion(input.fromProfileVersion)
  const toProfileVersion = asProfileVersion(input.toProfileVersion)
  if (!action || !status || !requestedBy || !fromProfileVersion || !toProfileVersion) return null
  return {
    id: input.id,
    policyDecisionId: input.policyDecisionId,
    action,
    networkId: input.networkId,
    fromProfileVersion,
    toProfileVersion,
    requestedBy,
    reason: input.reason ?? '',
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    status,
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.createdAt.toISOString(),
    ...(input.resumedAt ? { resumedAt: input.resumedAt.toISOString() } : {}),
    ...(input.terminalReason ? { terminalReason: input.terminalReason } : {})
  }
}

/**
 * 根据持久化字段重建内部网络分区状态。
 */
export function buildPartitionState(input: {
  networkId: string
  state: string
  reason: unknown
  transitionedAt: Date
  previousState: string | null
}): NetworkPartitionState | null {
  const state = asPartitionStatus(input.state)
  const reason = decodePartitionReason(input.reason)
  const previousState = input.previousState === null ? null : asPartitionStatus(input.previousState)
  if (!state || !reason) return null
  if (input.previousState !== null && previousState === null) return null
  return {
    networkId: input.networkId,
    state,
    reason,
    transitionedAt: input.transitionedAt.toISOString(),
    previousState
  }
}

/**
 * 根据持久化字段重建操作锁对象。
 */
export function buildOperationLock(input: {
  networkId: string
  operationType: string
  operationId: string
  idempotencyKey: string | null
  acquiredAt: Date
  expiresAt: Date
  status: string
  lockRowId: string
  fencingToken: number
  updatedAt: Date
}): NetworkOperationLock | null {
  const operationType = asOperationType(input.operationType)
  const status = asOperationLockStatus(input.status)
  if (!operationType || !status) return null
  return {
    networkId: input.networkId,
    operationType,
    operationId: input.operationId,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    acquiredAt: input.acquiredAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    status,
    lockRowId: input.lockRowId,
    fencingToken: input.fencingToken,
    updatedAt: input.updatedAt.toISOString()
  }
}
