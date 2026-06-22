import type {
  AclRuleFromSchema as AclRule,
  NetworkMapFromSchema as NetworkMap
} from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import { DEFAULT_CLOCK_SKEW_MS } from '../../m-net/src/key-lifecycle.ts'
import { DEFAULT_NETWORK_MAP_STALE_TTL_MS } from '../../m-net/src/network-map-renderer.ts'
import type { EnforcementDecision } from '../../m-net/src/network-map-types.ts'
import {
  resolveExpectedNetworkMapSigningPublicKey,
  verifyNetworkMapSignature
} from '../../m-net/src/network-map-signing.ts'
import {
  type NetworkPartitionState,
  type PartitionTransitionReason,
  type PartitionTransitionRequest,
  transitionPartitionState as transitionNetworkPartitionState
} from '../../m-net/src/partition-state.ts'

type NetworkMapMember = NetworkMap['members'][number]
type NetworkMapRelayAssignment = NonNullable<NetworkMap['relayAssignment']>

export type PartitionState = NetworkPartitionState
export type PartitionEvent = PartitionTransitionRequest

export type MapEvaluationFailureReason =
  | EnforcementDecision
  | {
      readonly decision: 'fail_closed'
      readonly reason: 'clock.skew_exceeded'
    }

export type MapPeerState = {
  readonly nodeId: string
  readonly tunnelIp: string
  readonly publicKey: string
}

export type AclDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: 'acl.default_deny' | 'acl.explicit_deny' }

export type KeyInfo = {
  readonly keyId: string
  readonly fingerprint: string
  readonly createdAt: string
  readonly rotationDueAt: string
}

export type KeyMetadataReport = {
  readonly keyId: string
  readonly fingerprint: string
  readonly createdAt: string
  readonly rotationDueAt: string
}

export type MapEvaluationInput = {
  readonly map: NetworkMap
  readonly agentNodeId: string
  readonly expectedSigningKeyId: string
  readonly expectedSigningPublicKey?: string
  readonly nowMs: number
  readonly serverTime: string
  readonly previousMapVersion?: number
  readonly staleTtlMs?: number
  readonly maxClockSkewMs?: number
}

export type MapEvaluationApplied = {
  readonly decision: 'apply'
  readonly networkId: string
  readonly mapVersion: number
  readonly signingKeyId: string
  readonly localTunnelIp?: string
  readonly peerSet: readonly MapPeerState[]
  readonly allowedPeers: readonly MapPeerState[]
  readonly relayAssignment?: NetworkMapRelayAssignment
}

export type MapEvaluationFailed = {
  readonly decision: 'fail_closed'
  readonly reason:
    | 'network_map.stale'
    | 'network_map.invalid_signature'
    | 'network_map.version_regression'
    | 'clock.skew_exceeded'
  readonly networkId: string
  readonly mapVersion: number
  readonly staleForMs?: number
}

export type MapEvaluationResult = MapEvaluationApplied | MapEvaluationFailed

export type AgentEnforcementState = {
  readonly status: 'idle' | 'applied' | 'stale' | 'fail_closed'
  readonly currentMapVersion?: number
  readonly currentSigningKeyId?: string
  readonly localTunnelIp?: string
  readonly knownPeers: readonly MapPeerState[]
  readonly allowedPeers: readonly MapPeerState[]
  readonly relayAssignment?: NetworkMapRelayAssignment
  readonly lastDecision?: MapEvaluationFailureReason
  readonly failureReason?: MapEvaluationFailed['reason']
  readonly partition: PartitionState
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isSignatureTrusted(
  map: NetworkMap,
  expectedSigningKeyId: string,
  expectedSigningPublicKey: string
): boolean {
  return verifyNetworkMapSignature(map, expectedSigningKeyId, expectedSigningPublicKey)
}

function toPeerState(member: NetworkMapMember): MapPeerState {
  return {
    nodeId: member.nodeId,
    tunnelIp: member.tunnelIp,
    publicKey: member.publicKey
  }
}

function transitionPartitionSafely(current: PartitionState, event: PartitionEvent): PartitionState {
  const transitioned = transitionNetworkPartitionState(current, event)
  return transitioned.kind === 'transitioned' ? transitioned.state : current
}

function buildRefreshReason(mapVersion: number): PartitionTransitionReason {
  return {
    code: 'network_map.refreshed',
    signedMapVersion: String(mapVersion)
  }
}

function buildSystemFailClosedReason(detail: string): PartitionTransitionReason {
  return {
    code: 'operator.fail_closed',
    actor: 'node-agent',
    detail
  }
}

function applySuccessfulPartitionTransition(
  current: PartitionState,
  decision: MapEvaluationApplied
): PartitionState {
  if (current.state === 'fail_closed' || current.state === 'stale') {
    return transitionPartitionSafely(current, {
      networkId: current.networkId,
      targetState: 'recovered',
      reason: buildRefreshReason(decision.mapVersion),
      transitionedAt: current.transitionedAt
    })
  }

  if (current.state === 'recovered') {
    return transitionPartitionSafely(current, {
      networkId: current.networkId,
      targetState: 'connected',
      reason: buildRefreshReason(decision.mapVersion),
      transitionedAt: current.transitionedAt
    })
  }

  return current
}

function applyFailedPartitionTransition(
  current: PartitionState,
  decision: MapEvaluationFailed
): PartitionState {
  if (decision.reason === 'network_map.stale') {
    if (current.state === 'connected' || current.state === 'recovered') {
      return transitionPartitionSafely(current, {
        networkId: current.networkId,
        targetState: 'stale',
        reason: {
          code: 'network_map.stale',
          staleForMs: decision.staleForMs ?? 0
        },
        transitionedAt: current.transitionedAt
      })
    }

    if (current.state === 'stale') {
      return transitionPartitionSafely(current, {
        networkId: current.networkId,
        targetState: 'fail_closed',
        reason: {
          code: 'network_map.expired',
          expiredForMs: decision.staleForMs ?? 0
        },
        transitionedAt: current.transitionedAt
      })
    }
  }

  if (current.state === 'fail_closed') {
    return current
  }

  return transitionPartitionSafely(current, {
    networkId: current.networkId,
    targetState: 'fail_closed',
    reason: buildSystemFailClosedReason(decision.reason),
    transitionedAt: current.transitionedAt
  })
}

/**
 * 评估单个节点对某个目标节点的 ACL 结果；默认拒绝，显式 deny 优先于 allow。
 */
export function evaluateAclForPeer(
  aclRules: AclRule[],
  sourceNodeId: string,
  targetNodeId: string
): AclDecision {
  const matchingRules = aclRules.filter(
    rule => rule.sourceNodeId === sourceNodeId && rule.targetNodeId === targetNodeId
  )

  if (matchingRules.some(rule => rule.action === 'deny')) {
    return { kind: 'deny', reason: 'acl.explicit_deny' }
  }

  if (matchingRules.some(rule => rule.action === 'allow')) {
    return { kind: 'allow' }
  }

  return { kind: 'deny', reason: 'acl.default_deny' }
}

/**
 * 评估收到的签名 network-map 是否可以应用到本地节点，并产出 peer/ACL 视图。
 */
export function evaluateNetworkMap(input: MapEvaluationInput): MapEvaluationResult {
  const staleTtlMs = input.staleTtlMs ?? DEFAULT_NETWORK_MAP_STALE_TTL_MS
  const maxClockSkewMs = input.maxClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS
  const serverTimeMs = parseTimestamp(input.serverTime)
  const map = input.map

  if (serverTimeMs === null || Math.abs(input.nowMs - serverTimeMs) > maxClockSkewMs) {
    return {
      decision: 'fail_closed',
      reason: 'clock.skew_exceeded',
      networkId: map.networkId,
      mapVersion: map.mapVersion
    }
  }

  if (
    !isSignatureTrusted(
      map,
      input.expectedSigningKeyId,
      input.expectedSigningPublicKey ?? resolveExpectedNetworkMapSigningPublicKey(process.env)
    )
  ) {
    return {
      decision: 'fail_closed',
      reason: 'network_map.invalid_signature',
      networkId: map.networkId,
      mapVersion: map.mapVersion
    }
  }

  if (input.previousMapVersion !== undefined && map.mapVersion < input.previousMapVersion) {
    return {
      decision: 'fail_closed',
      reason: 'network_map.version_regression',
      networkId: map.networkId,
      mapVersion: map.mapVersion
    }
  }

  const staleForMs = Math.max(0, input.nowMs - map.expiresAt)
  if (staleForMs > staleTtlMs) {
    return {
      decision: 'fail_closed',
      reason: 'network_map.stale',
      networkId: map.networkId,
      mapVersion: map.mapVersion,
      staleForMs
    }
  }

  const localMember = map.members.find(member => member.nodeId === input.agentNodeId)
  const peerSet = map.members.filter(member => member.nodeId !== input.agentNodeId).map(toPeerState)
  const allowedPeers = peerSet.filter(
    peer => evaluateAclForPeer([...map.aclRules], input.agentNodeId, peer.nodeId).kind === 'allow'
  )

  return {
    decision: 'apply',
    networkId: map.networkId,
    mapVersion: map.mapVersion,
    signingKeyId: map.signatureMetadata.keyId,
    peerSet,
    allowedPeers,
    ...(localMember?.tunnelIp === undefined ? {} : { localTunnelIp: localMember.tunnelIp }),
    ...(map.relayAssignment === undefined ? {} : { relayAssignment: map.relayAssignment })
  }
}

/**
 * 根据 map 评估结果更新本地 enforcement 状态，所有副作用由调用方在状态外层执行。
 */
export function applyEnforcementDecision(
  decision: MapEvaluationResult,
  currentState: AgentEnforcementState
): AgentEnforcementState {
  if (decision.decision === 'apply') {
    const partition = applySuccessfulPartitionTransition(currentState.partition, decision)
    return {
      status: 'applied',
      currentMapVersion: decision.mapVersion,
      currentSigningKeyId: decision.signingKeyId,
      knownPeers: decision.peerSet,
      allowedPeers: decision.allowedPeers,
      ...(decision.localTunnelIp === undefined ? {} : { localTunnelIp: decision.localTunnelIp }),
      ...(decision.relayAssignment === undefined
        ? {}
        : { relayAssignment: decision.relayAssignment }),
      lastDecision: { decision: 'apply' },
      partition
    }
  }

  const partition = applyFailedPartitionTransition(currentState.partition, decision)
  return {
    status: partition.state === 'stale' ? 'stale' : 'fail_closed',
    knownPeers: currentState.knownPeers,
    allowedPeers: currentState.allowedPeers,
    ...(currentState.currentMapVersion === undefined
      ? {}
      : { currentMapVersion: currentState.currentMapVersion }),
    ...(currentState.currentSigningKeyId === undefined
      ? {}
      : { currentSigningKeyId: currentState.currentSigningKeyId }),
    ...(currentState.localTunnelIp === undefined
      ? {}
      : { localTunnelIp: currentState.localTunnelIp }),
    ...(currentState.relayAssignment === undefined
      ? {}
      : { relayAssignment: currentState.relayAssignment }),
    lastDecision: {
      decision: 'fail_closed',
      reason: decision.reason
    },
    failureReason: decision.reason,
    partition
  }
}

/**
 * 对外暴露分区状态机包装器：合法转换返回新状态，非法转换保持当前状态不变。
 */
export function transitionPartitionState(
  current: PartitionState,
  event: PartitionEvent
): PartitionState {
  return transitionPartitionSafely(current, event)
}

/**
 * 生成发送给 M-Net 的公钥元数据报告，严格限制为可审计字段，不携带任何私钥材料。
 */
export function buildKeyMetadataReport(keyInfo: KeyInfo): KeyMetadataReport {
  return {
    keyId: keyInfo.keyId,
    fingerprint: keyInfo.fingerprint,
    createdAt: keyInfo.createdAt,
    rotationDueAt: keyInfo.rotationDueAt
  }
}
