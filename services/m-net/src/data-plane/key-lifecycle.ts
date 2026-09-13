export const DEFAULT_NODE_KEY_ROTATION_DAYS = 30
export const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000

export type KeyLifecycleResult<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError }

export type NodePublicKeyMetadata = {
  readonly nodeId: string
  readonly keyId: string
  readonly publicKey: string
  readonly fingerprint: string
  readonly algorithm: 'wireguard-x25519'
  readonly createdAt: string
  readonly rotatedAt?: string
  readonly rotationCounter: number
}

export type KeyInvalidFailure = {
  readonly kind: 'key.invalid'
  readonly reason: string
}

export type KeyDuplicateFailure = {
  readonly kind: 'key.duplicate'
  readonly nodeId: string
  readonly fingerprint: string
  readonly auditMetadata: {
    readonly action: 'mnet.node_key.duplicate_rejected'
    readonly nodeId: string
    readonly existingNodeId: string
    readonly fingerprint: string
  }
}

export type ValidatePublicKeyMetadataInput = {
  readonly nodeId: string
  readonly keyId: string
  readonly publicKey: string
  readonly createdAt: string
  readonly rotatedAt?: string
  readonly rotationCounter?: number
}

export type RejectDuplicatePublicKeyInput = ValidatePublicKeyMetadataInput & {
  readonly existingKeys: readonly NodePublicKeyMetadata[]
}

export type KeyRotationStatus = 'current' | 'rotation_due'

export type KeyRotationDecision = {
  readonly status: KeyRotationStatus
  readonly keyId: string
  readonly fingerprint: string
  readonly dueAt: string
}

export type EvaluateKeyRotationPolicyInput = {
  readonly metadata: NodePublicKeyMetadata
  readonly now: string
  readonly rotationDays?: number
}

export type ForcedKeyRotationPlan = {
  readonly action: 'rotate_node_key'
  readonly nodeId: string
  readonly keyId: string
  readonly fingerprint: string
  readonly plannedRotatedAt: string
}

export type PlanForcedKeyRotationInput = {
  readonly metadata: NodePublicKeyMetadata
  readonly plannedRotatedAt: string
}

export type ClockGatedOperation = 'join' | 'key_registration'

export type ClockSkewFailure = {
  readonly kind: 'clock.skew_exceeded'
  readonly skewMs: number
  readonly maxSkewMs: number
  readonly logEvidence: {
    readonly event: 'mnet.clock_skew.rejected'
    readonly operation: ClockGatedOperation
  }
  readonly auditEvidence: {
    readonly action: 'mnet.clock_skew.rejected'
    readonly result: 'rejected'
  }
}

export type GateClockSkewInput = {
  readonly operation: ClockGatedOperation
  readonly observedAt: string
  readonly reportedAt: string
  readonly maxSkewMs?: number
}

const WIREGUARD_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/

function invalidKey(reason: string): KeyLifecycleResult<never, KeyInvalidFailure> {
  return { ok: false, error: { kind: 'key.invalid', reason } }
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function parseTime(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isoAfter(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function rotationIntervalMs(days: number | undefined): number {
  const resolvedDays = days === undefined ? DEFAULT_NODE_KEY_ROTATION_DAYS : days
  return resolvedDays * 24 * 60 * 60 * 1000
}

function fingerprintPublicKey(publicKey: string): string {
  let hash = 0x811c9dc5
  for (const character of publicKey) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `wg:${hash.toString(16).padStart(8, '0')}`
}

function normalizeMetadata(input: ValidatePublicKeyMetadataInput): NodePublicKeyMetadata {
  return {
    nodeId: input.nodeId,
    keyId: input.keyId,
    publicKey: input.publicKey,
    fingerprint: fingerprintPublicKey(input.publicKey),
    algorithm: 'wireguard-x25519',
    createdAt: input.createdAt,
    ...(input.rotatedAt === undefined ? {} : { rotatedAt: input.rotatedAt }),
    rotationCounter: input.rotationCounter ?? 0
  }
}

/**
 * 校验节点 WireGuard 公钥元数据，只返回公钥和派生指纹，不接收或生成任何密钥材料。
 */
export function validatePublicKeyMetadata(
  input: ValidatePublicKeyMetadataInput
): KeyLifecycleResult<NodePublicKeyMetadata, KeyInvalidFailure> {
  if (!nonEmpty(input.nodeId)) return invalidKey('nodeId is required')
  if (!nonEmpty(input.keyId)) return invalidKey('keyId is required')
  if (!WIREGUARD_PUBLIC_KEY_PATTERN.test(input.publicKey)) {
    return invalidKey('public key must be 32-byte base64 text')
  }
  if (parseTime(input.createdAt) === null) return invalidKey('createdAt must be an ISO timestamp')
  if (input.rotatedAt !== undefined && parseTime(input.rotatedAt) === null) {
    return invalidKey('rotatedAt must be an ISO timestamp')
  }
  if (
    input.rotationCounter !== undefined &&
    (!Number.isInteger(input.rotationCounter) || input.rotationCounter < 0)
  ) {
    return invalidKey('rotationCounter must be a non-negative integer')
  }

  return { ok: true, value: normalizeMetadata(input) }
}

/**
 * 在已有节点公钥集合中拒绝重复公钥，返回包含审计元数据的纯失败结果。
 */
export function rejectDuplicatePublicKey(
  input: RejectDuplicatePublicKeyInput
): KeyLifecycleResult<NodePublicKeyMetadata, KeyInvalidFailure | KeyDuplicateFailure> {
  const metadata = validatePublicKeyMetadata(input)
  if (!metadata.ok) return metadata

  const duplicate = input.existingKeys.find(
    key =>
      key.publicKey === metadata.value.publicKey || key.fingerprint === metadata.value.fingerprint
  )
  if (duplicate !== undefined) {
    return {
      ok: false,
      error: {
        kind: 'key.duplicate',
        nodeId: metadata.value.nodeId,
        fingerprint: metadata.value.fingerprint,
        auditMetadata: {
          action: 'mnet.node_key.duplicate_rejected',
          nodeId: metadata.value.nodeId,
          existingNodeId: duplicate.nodeId,
          fingerprint: metadata.value.fingerprint
        }
      }
    }
  }

  return metadata
}

/**
 * 根据默认 30 天轮换窗口计算节点公钥是否到期，调用方负责把决策写入日志或审计。
 */
export function evaluateKeyRotationPolicy(
  input: EvaluateKeyRotationPolicyInput
): KeyRotationDecision {
  const basis = input.metadata.rotatedAt ?? input.metadata.createdAt
  const basisMs = parseTime(basis) ?? 0
  const dueMs = basisMs + rotationIntervalMs(input.rotationDays)
  const nowMs = parseTime(input.now) ?? 0
  return {
    status: nowMs >= dueMs ? 'rotation_due' : 'current',
    keyId: input.metadata.keyId,
    fingerprint: input.metadata.fingerprint,
    dueAt: isoAfter(dueMs)
  }
}

/**
 * 规划强制节点公钥轮换命令，只携带 keyId、fingerprint 和计划时间等可审计元数据。
 */
export function planForcedKeyRotation(input: PlanForcedKeyRotationInput): ForcedKeyRotationPlan {
  return {
    action: 'rotate_node_key',
    nodeId: input.metadata.nodeId,
    keyId: input.metadata.keyId,
    fingerprint: input.metadata.fingerprint,
    plannedRotatedAt: input.plannedRotatedAt
  }
}

/**
 * 校验加入和公钥登记请求的时钟偏移，超过阈值时返回日志与审计证据描述。
 */
export function gateClockSkew(
  input: GateClockSkewInput
): KeyLifecycleResult<{ readonly status: 'accepted' }, ClockSkewFailure> {
  const observedAt = parseTime(input.observedAt)
  const reportedAt = parseTime(input.reportedAt)
  const maxSkewMs = input.maxSkewMs ?? DEFAULT_CLOCK_SKEW_MS
  const skewMs =
    observedAt === null || reportedAt === null
      ? Number.MAX_SAFE_INTEGER
      : Math.abs(observedAt - reportedAt)

  if (skewMs > maxSkewMs) {
    return {
      ok: false,
      error: {
        kind: 'clock.skew_exceeded',
        skewMs,
        maxSkewMs,
        logEvidence: {
          event: 'mnet.clock_skew.rejected',
          operation: input.operation
        },
        auditEvidence: {
          action: 'mnet.clock_skew.rejected',
          result: 'rejected'
        }
      }
    }
  }

  return { ok: true, value: { status: 'accepted' } }
}
