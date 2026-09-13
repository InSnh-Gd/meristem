export type NetworkPartitionStatus = 'connected' | 'stale' | 'fail_closed' | 'recovered'

export type PartitionTransitionReason =
  | { code: 'initial.connect'; detail: string }
  | { code: 'network_map.stale'; staleForMs: number }
  | { code: 'network_map.expired'; expiredForMs: number }
  | { code: 'network_map.refreshed'; signedMapVersion: string }
  | { code: 'operator.fail_closed'; actor: string; detail: string }
  | { code: 'operator.recovered'; actor: string; detail: string }

export type NetworkPartitionState = {
  networkId: string
  state: NetworkPartitionStatus
  reason: PartitionTransitionReason
  transitionedAt: string
  previousState: NetworkPartitionStatus | null
}

export type PartitionTransitionRequest = {
  networkId: string
  targetState: NetworkPartitionStatus
  reason: PartitionTransitionReason
  transitionedAt: string
}

export type PartitionTransitionFailureCode =
  | 'partition.network_mismatch'
  | 'partition.invalid_transition'

export type PartitionTransitionFailure = {
  code: PartitionTransitionFailureCode
  message: string
  networkId: string
  currentState: NetworkPartitionStatus
  targetState: NetworkPartitionStatus
  reason: PartitionTransitionReason
}

export type PartitionTransitionAuditMetadata = {
  networkId: string
  previousState: NetworkPartitionStatus
  targetState: NetworkPartitionStatus
  reason: PartitionTransitionReason
  transitionedAt: string
}

export type PartitionTransitionResult =
  | {
      kind: 'transitioned'
      state: NetworkPartitionState
      audit: PartitionTransitionAuditMetadata
    }
  | { kind: 'failure'; failure: PartitionTransitionFailure }

const allowedTransitions: Record<NetworkPartitionStatus, readonly NetworkPartitionStatus[]> = {
  connected: ['stale', 'fail_closed'],
  stale: ['fail_closed', 'recovered', 'connected'],
  fail_closed: ['recovered'],
  recovered: ['connected', 'stale']
}

function createFailure(
  code: PartitionTransitionFailureCode,
  message: string,
  current: NetworkPartitionState,
  request: PartitionTransitionRequest
): PartitionTransitionFailure {
  return {
    code,
    message,
    networkId: request.networkId,
    currentState: current.state,
    targetState: request.targetState,
    reason: request.reason
  }
}

function canTransition(
  currentState: NetworkPartitionStatus,
  targetState: NetworkPartitionStatus
): boolean {
  return allowedTransitions[currentState].includes(targetState)
}

/**
 * 计算网络分区状态转换。
 * 函数只返回新状态和审计元数据，不读取时钟、不写日志、不修改传入对象。
 */
export function transitionPartitionState(
  current: NetworkPartitionState,
  request: PartitionTransitionRequest
): PartitionTransitionResult {
  if (current.networkId !== request.networkId) {
    return {
      kind: 'failure',
      failure: createFailure(
        'partition.network_mismatch',
        'partition transition network does not match current state',
        current,
        request
      )
    }
  }

  if (!canTransition(current.state, request.targetState)) {
    return {
      kind: 'failure',
      failure: createFailure(
        'partition.invalid_transition',
        'partition transition is not allowed from current state',
        current,
        request
      )
    }
  }

  const state: NetworkPartitionState = {
    networkId: current.networkId,
    state: request.targetState,
    reason: request.reason,
    transitionedAt: request.transitionedAt,
    previousState: current.state
  }

  return {
    kind: 'transitioned',
    state,
    audit: {
      networkId: current.networkId,
      previousState: current.state,
      targetState: request.targetState,
      reason: request.reason,
      transitionedAt: request.transitionedAt
    }
  }
}
