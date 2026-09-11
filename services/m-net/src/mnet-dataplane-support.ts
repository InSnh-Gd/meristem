import type { MNetworkMember } from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores, StoredTunnelAddressAllocation } from './data-plane-store-types.ts'
import {
  type BreakGlassDeps,
  type CHINA_DATA_PLANE_PROFILE_VERSION,
  type V03_PROFILE_VERSION,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

export type DataPlaneDeps = Required<Pick<ProfileWriteDeps, 'profileStore' | 'policyAuthorize'>> &
  Pick<ProfileWriteDeps, 'events' | 'log' | 'networkUpdater'> & {
    listMembers: NonNullable<ProfileWriteDeps['listMembers']>
    dataPlane: DataPlaneStores
    resolveNetBirdControlPlane?: ProfileWriteDeps['resolveNetBirdControlPlane']
  }

export type BreakGlassDataPlaneDeps = Required<
  Pick<BreakGlassDeps, 'profileStore' | 'policyAuthorize'>
> &
  Pick<BreakGlassDeps, 'events' | 'log' | 'networkUpdater'> & {
    listMembers: NonNullable<BreakGlassDeps['listMembers']>
    dataPlane: DataPlaneStores
  }

export type RelayAssignment = {
  nodeId: string
  relayEndpoint: string
  relayType: 'direct'
}

export type EnableDataPlaneSuccess = {
  status: 'enabled'
  profileVersion: typeof CHINA_DATA_PLANE_PROFILE_VERSION | typeof V03_PROFILE_VERSION
  correlationId: string
  operationId: string
  mapVersion: number
  relayAssignment: RelayAssignment
}

export type LatestNetworkMapSuccess = {
  map: import('../../../packages/contracts/src/schemas/mnet-profile.ts').NetworkMapFromSchema
}

// 单一定义源在 types.ts 叶模块（deps.ts 需要引用它且不得反向依赖本文件）；
// 此处 re-export 保持既有 `from './mnet-dataplane-support.ts'` 消费点兼容。
export type { NodeKeyRegistrationSuccess } from './types.ts'

export type MaterializedMembers = {
  relayAssignment: RelayAssignment
  mapVersion: number
}

function requestedAclRules(
  members: readonly MNetworkMember[]
): import('./network-map-types.ts').RequestedAclRule[] {
  return members.flatMap(source =>
    members
      .filter(target => target.nodeId !== source.nodeId)
      .map(target => ({
        action: 'allow' as const,
        sourceNodeId: source.nodeId,
        targetNodeId: target.nodeId,
        protocol: 'any' as const
      }))
  )
}

/**
 * 从成员中挑选 relay。入参放宽为结构化的 `{ nodeId, nodeKind }`：调用方可能在渲染阶段
 * 已按「是否持有真实运行时密钥」隔离掉部分成员，必须能只把**隔离后**的成员交给本函数，
 * 否则被隔离的节点仍会被选为 relay 并写进持久化行、enable 响应与事件。
 */
function relayForMembers(
  members: readonly { nodeId: string; nodeKind: 'stem' | 'leaf' }[]
): RelayAssignment {
  const preferred = members.find(member => member.nodeKind === 'stem') ?? members[0]
  return {
    nodeId: preferred?.nodeId ?? 'relay-missing',
    // legacy: v0.1 used 'wstunnel' relay type — v0.2 runtime uses direct relay endpoint
    relayType: 'direct',
    relayEndpoint: `https://relay.${preferred?.nodeId ?? 'missing'}.meristem.internal:443`
  }
}

/** 统一把基础设施异常转成 typed failure。 */
export function asFailure(error: unknown, code = 'dataplane.store_failed'): ProfileWorkflowFailure {
  return profileWorkflowFailure(503, code, error instanceof Error ? error.message : String(error))
}

/** 从显式传入或依赖对象读取数据面存储。 */
export function getDataPlaneStores(dataPlane?: DataPlaneStores | null): DataPlaneStores | null {
  return dataPlane ?? null
}

/** 校验数据面工作流依赖，缺失时保持 fail-closed。 */
export function requireDataPlaneDeps(
  deps: Partial<
    Pick<
      ProfileWriteDeps,
      | 'profileStore'
      | 'policyAuthorize'
      | 'dataPlane'
      | 'events'
      | 'log'
      | 'networkUpdater'
      | 'listMembers'
      | 'resolveNetBirdControlPlane'
    >
  >
): DataPlaneDeps | ProfileWorkflowFailure {
  if (!deps.profileStore || !deps.policyAuthorize || !deps.listMembers) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'data-plane orchestration features are not available'
    )
  }
  const dataPlane = deps.dataPlane ?? null
  if (!dataPlane) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'data-plane orchestration features are not available'
    )
  }
  return {
    profileStore: deps.profileStore,
    policyAuthorize: deps.policyAuthorize,
    listMembers: deps.listMembers,
    dataPlane,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {}),
    ...(deps.resolveNetBirdControlPlane
      ? { resolveNetBirdControlPlane: deps.resolveNetBirdControlPlane }
      : {})
  }
}

/** 审计写入是高风险 enable 的强制门；失败时立即 fail-closed。 */
export async function writeRequiredAudit(
  deps: Pick<DataPlaneDeps, 'log'>,
  actor: string,
  action: string,
  resource: string,
  result: string,
  correlationId: string,
  payload?: unknown
): Promise<true | ProfileWorkflowFailure> {
  try {
    if (!deps.log) return profileWorkflowFailure(503, 'audit.unavailable', 'audit log is required')
    await deps.log.writeAudit(actor, action, resource, result, correlationId, payload)
    return true
  } catch (error) {
    return asFailure(error, 'audit.write_failed')
  }
}

/** enable/rotate 成功后统一写事件、timeline、full artifacts。 */
export async function writeOptionalArtifacts(
  deps: Pick<DataPlaneDeps, 'log' | 'events'>,
  input: {
    correlationId: string
    networkId: string
    mapVersion: number
    relayAssignment: RelayAssignment
    profileVersion: string
    operationId: string
  }
): Promise<true | ProfileWorkflowFailure> {
  try {
    await deps.events?.publish(
      'mnet.relay.assigned.v0',
      'mnet.relay.assigned',
      {
        networkId: input.networkId,
        relayAssignment: input.relayAssignment,
        correlationId: input.correlationId
      },
      input.correlationId
    )
    await deps.events?.publish(
      'mnet.network_map.published.v0',
      'mnet.network_map.published',
      {
        networkId: input.networkId,
        mapVersion: input.mapVersion,
        profileVersion: input.profileVersion,
        relayAssignment: input.relayAssignment,
        correlationId: input.correlationId
      },
      input.correlationId
    )
    await deps.events?.publish(
      'mnet.profile.enabled.v0',
      'mnet.profile.enabled',
      {
        networkId: input.networkId,
        toProfileVersion: input.profileVersion,
        actor: 'system',
        operationId: input.operationId,
        correlationId: input.correlationId,
        controlPlaneOnly: false
      },
      input.correlationId
    )
    await deps.log?.writeTimeline(
      `data-plane profile enabled for network ${input.networkId}`,
      'mnet.profile.enabled',
      input.correlationId
    )
    await deps.log?.writeFull(
      'info',
      `network map ${input.mapVersion} published for network ${input.networkId}`,
      input.correlationId,
      { relayAssignment: input.relayAssignment, operationId: input.operationId }
    )
    return true
  } catch (error) {
    return asFailure(error, 'event.publish_failed')
  }
}

/** 为 network-map 渲染构建默认 ACL 规则。 */
export function buildRequestedAclRules(
  members: readonly MNetworkMember[]
): import('./network-map-types.ts').RequestedAclRule[] {
  return requestedAclRules(members)
}

/** 选择当前网络的 relay 分配。 */
/** 选择网络 relay；入参须为**隔离后**的成员集合，避免把无运行时密钥的节点选为 relay。 */
export function selectRelayForMembers(
  members: readonly { nodeId: string; nodeKind: 'stem' | 'leaf' }[]
): RelayAssignment {
  return relayForMembers(members)
}

/** 将持久化 tunnel allocation 转换成纯地址分配函数输入。 */
export function toTunnelAssignments(
  allocations: readonly StoredTunnelAddressAllocation[]
): Array<{ networkId: string; nodeId: string; tunnelIp: string; cidr: string }> {
  return allocations.map(allocation => ({
    networkId: allocation.networkId,
    nodeId: allocation.nodeId,
    tunnelIp: allocation.tunnelIp,
    cidr: allocation.subnetCidr
  }))
}
