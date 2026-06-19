import type { MNetworkMember } from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores, StoredTunnelAddressAllocation } from './data-plane-store-types.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  type BreakGlassDeps,
  type CHINA_DATA_PLANE_PROFILE_VERSION,
  type ProfileWorkflowFailure,
  type ProfileWriteDeps,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

export type DataPlaneDeps = Required<Pick<ProfileWriteDeps, 'profileStore' | 'policyAuthorize'>> &
  Pick<ProfileWriteDeps, 'events' | 'log' | 'networkUpdater'> & {
    listMembers: NonNullable<ProfileWriteDeps['listMembers']>
    dataPlane: DataPlaneStores
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
  relayType: 'wstunnel' | 'direct'
}

export type EnableDataPlaneSuccess = {
  status: 'enabled'
  profileVersion: typeof CHINA_DATA_PLANE_PROFILE_VERSION
  correlationId: string
  operationId: string
  mapVersion: number
  relayAssignment: RelayAssignment
}

export type LatestNetworkMapSuccess = {
  map: import('../../../packages/contracts/src/schemas/mnet-profile.ts').NetworkMapFromSchema
}

export type NodeKeyRegistrationSuccess = {
  nodeId: string
  keyId: string
  fingerprint: string
  mapVersion: number
  correlationId: string
}

export type MaterializedMembers = {
  relayAssignment: RelayAssignment
  mapVersion: number
}

function bootstrapPublicKey(nodeId: string): string {
  const seed = nodeId
    .replace(/[^A-Za-z0-9]/g, 'A')
    .padEnd(43, 'B')
    .slice(0, 43)
  return `${seed}=`
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

function relayForMembers(members: readonly MNetworkMember[]): RelayAssignment {
  const preferred = members.find(member => member.nodeKind === 'stem') ?? members[0]
  return {
    nodeId: preferred?.nodeId ?? 'relay-missing',
    relayType: 'wstunnel',
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
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'policyAuthorize'
    | 'dataPlane'
    | 'events'
    | 'log'
    | 'networkUpdater'
    | 'listMembers'
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
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {})
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

/** 返回节点 bootstrap 公钥，占位生成只用于控制面编排测试与默认初始化。 */
export function bootstrapNodePublicKey(nodeId: string): string {
  return bootstrapPublicKey(nodeId)
}

/** 为 network-map 渲染构建默认 ACL 规则。 */
export function buildRequestedAclRules(
  members: readonly MNetworkMember[]
): import('./network-map-types.ts').RequestedAclRule[] {
  return requestedAclRules(members)
}

/** 选择当前网络的 relay 分配。 */
export function selectRelayForMembers(members: readonly MNetworkMember[]): RelayAssignment {
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
