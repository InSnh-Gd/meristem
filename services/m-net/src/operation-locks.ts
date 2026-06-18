export type NetworkOperationType = 'migration' | 'apply' | 'break_glass' | 'rotation'

export type OperationLockStatus = 'active' | 'released' | 'interrupted' | 'expired'

export type OperationTransitionReason =
  | { code: 'profile.apply'; detail: string }
  | { code: 'profile.migration'; detail: string }
  | { code: 'profile.disable'; detail: string }
  | { code: 'credential.rotation'; detail: string }
  | { code: 'operator.break_glass'; actor: 'security-admin'; detail: string }
  | { code: 'operation.completed'; detail: string }
  | { code: 'operation.lock.expired'; detail: string }

export type NetworkOperationLock = {
  networkId: string
  operationType: NetworkOperationType
  operationId: string
  idempotencyKey?: string
  acquiredAt: string
  expiresAt: string
  status: OperationLockStatus
  lockRowId: string
  fencingToken: number
  updatedAt: string
}

export type OperationLockRequest = {
  networkId: string
  operationType: NetworkOperationType
  operationId: string
  idempotencyKey?: string
  requestedAt: string
  ttlMs: number
  reason: OperationTransitionReason
  lockRowId?: string
}

export type NetworkOperationRecordStatus =
  | 'accepted'
  | 'completed'
  | 'interrupted'
  | 'expired'
  | 'failed'

export type NetworkOperationRecord = {
  networkId: string
  operationType: NetworkOperationType
  operationId: string
  idempotencyKey?: string
  status: NetworkOperationRecordStatus
  requestedAt: string
  stateTransitionCount: number
  auditActionCount: number
}

export type OperationLockFailureCode =
  | 'operation.locked'
  | 'operation.invalid_request'
  | 'operation.not_active'

export type OperationLockFailure = {
  code: OperationLockFailureCode
  message: string
  networkId: string
  activeOperationId?: string
  activeOperationType?: NetworkOperationType
}

export type OperationLockAuditMetadata = {
  networkId: string
  action:
    | 'operation.lock.acquired'
    | 'operation.lock.released'
    | 'operation.lock.preempted'
    | 'operation.lock.expired'
    | 'operation.idempotency.duplicate'
  operationId: string
  operationType: NetworkOperationType
  reason: OperationTransitionReason
  interruptedOperationId?: string
  interruptedOperationType?: NetworkOperationType
  preemptingOperationId?: string
  expiredOperationId?: string
}

export type AcquireOperationLockResult =
  | {
      kind: 'acquired'
      lock: NetworkOperationLock
      audit: OperationLockAuditMetadata
      expiredLock?: NetworkOperationLock
    }
  | { kind: 'failure'; failure: OperationLockFailure }

export type BreakGlassPreemptResult =
  | {
      kind: 'preempted'
      interruptedLock: NetworkOperationLock
      breakGlassLock: NetworkOperationLock
      audit: OperationLockAuditMetadata
    }
  | {
      kind: 'acquired'
      breakGlassLock: NetworkOperationLock
      audit: OperationLockAuditMetadata
    }
  | { kind: 'failure'; failure: OperationLockFailure }

export type IdempotentOperationResult =
  | {
      kind: 'created'
      operation: NetworkOperationRecord
      audit: OperationLockAuditMetadata
      stateTransitionCount: 1
      auditActionCount: 1
    }
  | {
      kind: 'duplicate'
      operation: NetworkOperationRecord
      originalOperationId: string
      audit: OperationLockAuditMetadata
      stateTransitionCount: 0
      auditActionCount: 0
    }
  | { kind: 'failure'; failure: OperationLockFailure }

export type ReleaseOperationLockResult =
  | { kind: 'released'; lock: NetworkOperationLock; audit: OperationLockAuditMetadata }
  | { kind: 'failure'; failure: OperationLockFailure }

export type ReleaseOperationLockRequest = {
  completedAt: string
  reason: Extract<OperationTransitionReason, { code: 'operation.completed' }>
}

function createFailure(
  code: OperationLockFailureCode,
  message: string,
  networkId: string,
  activeLock?: NetworkOperationLock
): OperationLockFailure {
  return {
    code,
    message,
    networkId,
    ...(activeLock
      ? {
          activeOperationId: activeLock.operationId,
          activeOperationType: activeLock.operationType
        }
      : {})
  }
}

function expiresAt(requestedAt: string, ttlMs: number): string {
  return new Date(new Date(requestedAt).getTime() + ttlMs).toISOString()
}

function isExpired(lock: NetworkOperationLock, requestedAt: string): boolean {
  return new Date(lock.expiresAt).getTime() <= new Date(requestedAt).getTime()
}

function createLock(request: OperationLockRequest, fencingToken: number): NetworkOperationLock {
  return {
    networkId: request.networkId,
    operationType: request.operationType,
    operationId: request.operationId,
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    acquiredAt: request.requestedAt,
    expiresAt: expiresAt(request.requestedAt, request.ttlMs),
    status: 'active',
    lockRowId: request.lockRowId ?? `${request.networkId}:${request.operationId}`,
    fencingToken,
    updatedAt: request.requestedAt
  }
}

function createAcquireAudit(request: OperationLockRequest): OperationLockAuditMetadata {
  return {
    networkId: request.networkId,
    action: 'operation.lock.acquired',
    operationId: request.operationId,
    operationType: request.operationType,
    reason: request.reason
  }
}

function expireLock(lock: NetworkOperationLock, requestedAt: string): NetworkOperationLock {
  return {
    ...lock,
    status: 'expired',
    updatedAt: requestedAt
  }
}

/**
 * 尝试为单个 network 获取互斥操作锁。
 * 已过期锁会在返回值中被标记为 expired，调用方后续可映射为 PostgreSQL 行更新。
 */
export function acquireOperationLock(input: {
  existingLock: NetworkOperationLock | null
  request: OperationLockRequest
}): AcquireOperationLockResult {
  const { existingLock, request } = input
  if (request.ttlMs <= 0) {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.invalid_request',
        'operation ttl must be positive',
        request.networkId
      )
    }
  }

  if (existingLock && existingLock.networkId !== request.networkId) {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.invalid_request',
        'existing lock belongs to a different network',
        request.networkId,
        existingLock
      )
    }
  }

  if (!existingLock || existingLock.status !== 'active') {
    return {
      kind: 'acquired',
      lock: createLock(request, (existingLock?.fencingToken ?? 0) + 1),
      audit: createAcquireAudit(request)
    }
  }

  if (isExpired(existingLock, request.requestedAt)) {
    const expiredLock = expireLock(existingLock, request.requestedAt)
    const lock = createLock(request, existingLock.fencingToken + 1)
    return {
      kind: 'acquired',
      lock,
      expiredLock,
      audit: {
        ...createAcquireAudit(request),
        action: 'operation.lock.expired',
        expiredOperationId: existingLock.operationId
      }
    }
  }

  return {
    kind: 'failure',
    failure: createFailure(
      'operation.locked',
      'network already has an active operation lock',
      request.networkId,
      existingLock
    )
  }
}

/**
 * 执行 break-glass 抢占规则。
 * 只允许 break_glass 请求抢占 migration、apply 或 rotation 的 active 锁。
 */
export function preemptWithBreakGlass(
  currentLock: NetworkOperationLock | null,
  request: OperationLockRequest
): BreakGlassPreemptResult {
  if (request.operationType !== 'break_glass') {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.invalid_request',
        'preemption requires break-glass operation type',
        request.networkId
      )
    }
  }

  if (!currentLock || currentLock.status !== 'active') {
    const breakGlassLock = createLock(request, (currentLock?.fencingToken ?? 0) + 1)
    return {
      kind: 'acquired',
      breakGlassLock,
      audit: createAcquireAudit(request)
    }
  }

  if (currentLock.networkId !== request.networkId) {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.invalid_request',
        'current lock belongs to a different network',
        request.networkId,
        currentLock
      )
    }
  }

  if (currentLock.operationType === 'break_glass') {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.locked',
        'break-glass operation is already active',
        request.networkId,
        currentLock
      )
    }
  }

  const interruptedLock: NetworkOperationLock = {
    ...currentLock,
    status: 'interrupted',
    updatedAt: request.requestedAt
  }
  const breakGlassLock = createLock(request, currentLock.fencingToken + 1)

  return {
    kind: 'preempted',
    interruptedLock,
    breakGlassLock,
    audit: {
      networkId: request.networkId,
      action: 'operation.lock.preempted',
      operationId: request.operationId,
      operationType: request.operationType,
      reason: request.reason,
      interruptedOperationId: currentLock.operationId,
      interruptedOperationType: currentLock.operationType,
      preemptingOperationId: request.operationId
    }
  }
}

/**
 * 解析幂等操作请求。
 * 相同 network、operationType 与 idempotencyKey 命中时只返回原操作引用，不新增状态转换或审计动作。
 */
export function registerIdempotentOperation(
  request: OperationLockRequest,
  existingOperations: readonly NetworkOperationRecord[]
): IdempotentOperationResult {
  if (!request.idempotencyKey) {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.invalid_request',
        'idempotency key is required',
        request.networkId
      )
    }
  }

  const existing = existingOperations.find(
    operation =>
      operation.networkId === request.networkId &&
      operation.operationType === request.operationType &&
      operation.idempotencyKey === request.idempotencyKey
  )

  if (existing) {
    return {
      kind: 'duplicate',
      operation: existing,
      originalOperationId: existing.operationId,
      audit: {
        networkId: request.networkId,
        action: 'operation.idempotency.duplicate',
        operationId: existing.operationId,
        operationType: existing.operationType,
        reason: request.reason
      },
      stateTransitionCount: 0,
      auditActionCount: 0
    }
  }

  const operation: NetworkOperationRecord = {
    networkId: request.networkId,
    operationType: request.operationType,
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    status: 'accepted',
    requestedAt: request.requestedAt,
    stateTransitionCount: 1,
    auditActionCount: 1
  }

  return {
    kind: 'created',
    operation,
    audit: createAcquireAudit(request),
    stateTransitionCount: 1,
    auditActionCount: 1
  }
}

/**
 * 将 active 锁释放为 released。
 * 返回值携带审计元数据，避免 support 层依赖异常或隐藏副作用。
 */
export function releaseOperationLock(
  lock: NetworkOperationLock,
  request: ReleaseOperationLockRequest
): ReleaseOperationLockResult {
  if (lock.status !== 'active') {
    return {
      kind: 'failure',
      failure: createFailure(
        'operation.not_active',
        'only active locks can be released',
        lock.networkId
      )
    }
  }

  const releasedLock: NetworkOperationLock = {
    ...lock,
    status: 'released',
    updatedAt: request.completedAt
  }

  return {
    kind: 'released',
    lock: releasedLock,
    audit: {
      networkId: lock.networkId,
      action: 'operation.lock.released',
      operationId: lock.operationId,
      operationType: lock.operationType,
      reason: request.reason
    }
  }
}
