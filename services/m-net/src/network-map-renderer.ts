import type {
  AclRuleFromSchema as AclRule,
  NetworkMapFromSchema as NetworkMap,
  NetworkMapSigningMetadataFromSchema as NetworkMapSigningMetadata
} from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type {
  EnforcementDecision,
  NetworkMapEnforcementInput,
  NetworkMapMemberInput,
  NetworkMapRenderInput,
  RenderedNetworkMap,
  RequestedAclRule
} from './network-map-types.ts'
import { buildNetworkMapSignatureMetadata } from './network-map-signing.ts'

export const NETWORK_MAP_STALE_TTL_ENV_KEY = 'MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS'
export const DEFAULT_NETWORK_MAP_STALE_TTL_MS = 900_000

type NetworkMapEnv = Readonly<Record<string, string | undefined>>

/**
 * 解析签名地图过期阈值。无效配置必须回落到 15 分钟默认值，避免误放宽 agent 执行窗口。
 */
export function resolveNetworkMapStaleTtlMs(env: NetworkMapEnv): number {
  const configured = env[NETWORK_MAP_STALE_TTL_ENV_KEY]
  const value = configured === undefined ? DEFAULT_NETWORK_MAP_STALE_TTL_MS : Number(configured)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_NETWORK_MAP_STALE_TTL_MS
}

/**
 * 计算下一版 mapVersion，确保每次渲染都相对上一版单调递增。
 */
export function nextNetworkMapVersion(previousMapVersion: number): number {
  if (!Number.isFinite(previousMapVersion) || previousMapVersion < 0) return 1
  return Math.trunc(previousMapVersion) + 1
}

/**
 * 计算签名地图过期时间。调用方传入固定时间即可保持纯函数可重复。
 */
export function calculateNetworkMapExpiresAt(issuedAt: number, staleTtlMs: number): number {
  return issuedAt + staleTtlMs
}

/**
 * 将已经授权的 ACL 请求渲染为有效规则，并过滤掉已离开网络的成员引用。
 */
export function renderEffectiveAclRules(input: NetworkMapRenderInput): AclRule[] {
  const activeNodeIds = new Set(input.members.map(member => member.nodeId))
  const activeRules = input.requestedAclRules.filter(rule => isRuleActive(rule, activeNodeIds))

  return activeRules.map((rule, index) => ({
    ruleId: `acl-${index + 1}-${rule.sourceNodeId}-${rule.targetNodeId}-${rule.protocol}`,
    action: rule.action,
    sourceNodeId: rule.sourceNodeId,
    targetNodeId: rule.targetNodeId,
    protocol: rule.protocol
  }))
}

/**
 * 渲染整网签名地图，供 Core / M-Net 发布或审计时使用。
 */
export function renderNetworkMap(input: NetworkMapRenderInput): NetworkMap {
  return buildNetworkMap(input, input.members, renderEffectiveAclRules(input))
}

/**
 * 按目标节点裁剪 peer set，只保留该节点自身和 ACL 显式允许的对端。
 */
export function renderNetworkMapForNode(input: NetworkMapRenderInput, nodeId: string): NetworkMap {
  const effectiveRules = renderEffectiveAclRules(input)
  const visibleNodeIds = visiblePeerIdsForNode(nodeId, effectiveRules)
  const visibleMembers = input.members.filter(member => visibleNodeIds.has(member.nodeId))
  const visibleRules = effectiveRules.filter(
    rule =>
      visibleNodeIds.has(rule.sourceNodeId) &&
      visibleNodeIds.has(rule.targetNodeId) &&
      (rule.sourceNodeId === nodeId || rule.targetNodeId === nodeId)
  )

  return buildNetworkMap(input, visibleMembers, visibleRules)
}

/**
 * 为每个网络成员渲染独立签名地图，agent 可直接消费结果而不访问策略服务。
 */
export function renderNetworkMaps(input: NetworkMapRenderInput): RenderedNetworkMap[] {
  return input.members.map(member => ({
    nodeId: member.nodeId,
    map: renderNetworkMapForNode(input, member.nodeId)
  }))
}

/**
 * 节点侧执行签名地图前的本地判定，过期、签名缺失或版本回退都必须失败关闭。
 */
export function decideNetworkMapEnforcement(
  input: NetworkMapEnforcementInput
): EnforcementDecision {
  if (input.nowMs > input.map.expiresAt) {
    return { decision: 'fail_closed', reason: 'network_map.stale' }
  }

  if (input.map.signatureMetadata.value.length === 0) {
    return { decision: 'fail_closed', reason: 'network_map.invalid_signature' }
  }

  if (input.previousMapVersion !== undefined && input.map.mapVersion < input.previousMapVersion) {
    return { decision: 'fail_closed', reason: 'network_map.version_regression' }
  }

  return { decision: 'apply' }
}

function isRuleActive(rule: RequestedAclRule, activeNodeIds: ReadonlySet<string>): boolean {
  return activeNodeIds.has(rule.sourceNodeId) && activeNodeIds.has(rule.targetNodeId)
}

function visiblePeerIdsForNode(nodeId: string, rules: readonly AclRule[]): Set<string> {
  const visibleNodeIds = new Set<string>([nodeId])

  for (const rule of rules) {
    if (rule.action !== 'allow') continue
    if (rule.sourceNodeId === nodeId) visibleNodeIds.add(rule.targetNodeId)
    if (rule.targetNodeId === nodeId) visibleNodeIds.add(rule.sourceNodeId)
  }

  return visibleNodeIds
}

function buildNetworkMap(
  input: NetworkMapRenderInput,
  members: readonly NetworkMapMemberInput[],
  aclRules: readonly AclRule[]
): NetworkMap {
  const mapVersion = nextNetworkMapVersion(input.previousMapVersion)
  const staleTtlMs = input.staleTtlMs ?? DEFAULT_NETWORK_MAP_STALE_TTL_MS
  const visibleNodeIds = new Set(members.map(member => member.nodeId))
  const relayAssignment = input.relayAssignment
    ? {
        relayType: input.relayAssignment.relayType,
        relayEndpoint: input.relayAssignment.relayEndpoint,
        nodeIds: input.relayAssignment.nodeIds.filter(nodeId => visibleNodeIds.has(nodeId))
      }
    : undefined

  const mapWithoutSignature = {
    profileVersion: input.profileVersion,
    networkId: input.networkId,
    members: members.map(member => ({
      nodeId: member.nodeId,
      tunnelIp: member.tunnelIp,
      publicKey: member.publicKey,
      ...(member.endpoint ? { endpoint: member.endpoint } : {})
    })),
    aclRules: [...aclRules],
    expiresAt: calculateNetworkMapExpiresAt(input.issuedAt, staleTtlMs),
    mapVersion,
    ...(relayAssignment === undefined ? {} : { relayAssignment })
  }

  const signatureMetadata: NetworkMapSigningMetadata = buildNetworkMapSignatureMetadata(
    mapWithoutSignature,
    {
      keyId: input.signingKeyId,
      privateKeyPem: input.signingPrivateKeyPem
    }
  )

  return { ...mapWithoutSignature, signatureMetadata }
}
