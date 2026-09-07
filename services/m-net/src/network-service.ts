import { and, eq, inArray } from 'drizzle-orm'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary
} from '../../../packages/contracts/src/index.ts'
import {
  mnetDataPlaneOperationLocks,
  mnetNetworkMapRenders,
  mnetNodePublicKeys,
  mnetPartitionStates,
  mnetProfileMigrations,
  mnetRelayAssignments,
  mnetSidecarDesiredConfigs,
  mnetTunnelAddressAllocations,
  networkMemberships,
  mnetNetworkProfileStates,
  networks,
  nodes
} from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import type { GlobalDefaultsStore } from './global-defaults-store.ts'
import { isNodeExcludedFromPeerPaths } from './node-control-state-machine.ts'
import type { ProfileStore } from './profile-store.ts'
import { asNodeKind, asNodeStatus, err, mapNetwork, membershipModeFor, ok } from './shared.ts'
import type { MNetServiceResult } from './types.ts'

type NetworkServiceDeps = {
  db: MNetDb
  profileStore: ProfileStore
  globalDefaultsStore?: GlobalDefaultsStore
  /** 成员变更后刷新签名网络地图；由启动装配注入，测试可省略。 */
  refreshNetworkMap?: (networkId: string, correlationId: string) => Promise<void>
}

/**
 * 逻辑网络的创建、加入与成员查询保持在独立模块中，避免入口文件同时承载网络模型和 session 运行态。
 */
export function createNetworkService({
  db,
  profileStore,
  globalDefaultsStore,
  refreshNetworkMap
}: NetworkServiceDeps) {
  async function createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>> {
    const existing = await db.select().from(networks).where(eq(networks.name, input.name)).limit(1)
    if (existing[0]) return err('network.conflict', 'network name already exists')

    // 使用全局默认 profile，如果未配置则使用内置默认
    const defaultProfileVersion = globalDefaultsStore
      ? await globalDefaultsStore.getDefaultProfileVersion()
      : 'm-net@0.3.0'

    const now = new Date()
    const network: typeof networks.$inferInsert = {
      id: crypto.randomUUID(),
      name: input.name,
      profileVersion: defaultProfileVersion,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }

    await db.insert(networks).values(network)
    await profileStore.setNetworkState(network.id, {
      profileVersion: network.profileVersion,
      status: 'disabled'
    })
    return ok(
      mapNetwork({
        ...network,
        displayName: network.displayName ?? null
      })
    )
  }

  async function listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>> {
    const [networkRows, membershipRows] = await Promise.all([
      db.select().from(networks),
      db.select().from(networkMemberships)
    ])

    // 先聚合成员行，避免为每个网络重复扫描并分配过滤结果数组。
    const membershipCounts = new Map<string, number>()
    for (const membership of membershipRows) {
      membershipCounts.set(
        membership.networkId,
        (membershipCounts.get(membership.networkId) ?? 0) + 1
      )
    }

    return ok(
      networkRows.map(network => ({
        ...mapNetwork(network),
        memberCount: membershipCounts.get(network.id) ?? 0
      }))
    )
  }

  async function joinNetwork(input: {
    networkId: string
    nodeId: string
  }): Promise<MNetServiceResult<MNetworkMember>> {
    const [networkRow] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!networkRow) return err('network.not_found', 'network not found')

    const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, input.nodeId)).limit(1)
    if (!nodeRow) return err('node.not_found', 'node not found')

    const nodeKind = asNodeKind(nodeRow.kind)
    if (!nodeKind) return err('node.invalid_kind', 'node kind cannot join logical networks')
    if (nodeRow.status !== 'healthy') {
      return err('node.invalid_status', 'node must be healthy')
    }

    const [existingMembership] = await db
      .select()
      .from(networkMemberships)
      .where(
        and(
          eq(networkMemberships.networkId, input.networkId),
          eq(networkMemberships.nodeId, input.nodeId)
        )
      )
      .limit(1)

    if (existingMembership) {
      return ok({
        networkId: existingMembership.networkId,
        nodeId: existingMembership.nodeId,
        nodeKind,
        membershipMode: membershipModeFor(nodeKind),
        status: existingMembership.status as MNetworkMember['status'],
        joinedAt: existingMembership.joinedAt.toISOString()
      })
    }

    if (nodeKind === 'leaf') {
      const stemMembers = await db
        .select({ nodeKind: nodes.kind })
        .from(networkMemberships)
        .innerJoin(nodes, eq(networkMemberships.nodeId, nodes.id))
        .where(eq(networkMemberships.networkId, input.networkId))
      const hasStemMember = stemMembers.some(member => member.nodeKind === 'stem')
      if (!hasStemMember) return err('network.stem_required', 'leaf nodes require a stem member')
    }

    const now = new Date()
    await db.insert(networkMemberships).values({
      networkId: input.networkId,
      nodeId: input.nodeId,
      membershipMode: membershipModeFor(nodeKind),
      status: 'joined',
      joinedAt: now,
      updatedAt: now
    })

    return ok({
      networkId: input.networkId,
      nodeId: input.nodeId,
      nodeKind,
      membershipMode: membershipModeFor(nodeKind),
      status: 'joined',
      joinedAt: now.toISOString()
    })
  }

  async function listMembers(input: {
    networkId: string
  }): Promise<MNetServiceResult<MNetworkMember[]>> {
    const [networkRow] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!networkRow) return err('network.not_found', 'network not found')

    const rows = await db
      .select({
        networkId: networkMemberships.networkId,
        nodeId: networkMemberships.nodeId,
        membershipMode: networkMemberships.membershipMode,
        status: networkMemberships.status,
        joinedAt: networkMemberships.joinedAt,
        nodeKind: nodes.kind,
        nodeStatus: nodes.status
      })
      .from(networkMemberships)
      .innerJoin(nodes, eq(networkMemberships.nodeId, nodes.id))
      .where(eq(networkMemberships.networkId, input.networkId))

    return ok(
      rows.flatMap(row => {
        const nodeKind = asNodeKind(row.nodeKind)
        const nodeStatus = asNodeStatus(row.nodeStatus)
        if (!nodeKind || !nodeStatus || isNodeExcludedFromPeerPaths(nodeStatus)) return []
        return [
          {
            networkId: row.networkId,
            nodeId: row.nodeId,
            nodeKind,
            membershipMode: membershipModeFor(nodeKind),
            status: row.status as MNetworkMember['status'],
            joinedAt: row.joinedAt.toISOString()
          }
        ]
      })
    )
  }

  /**
   * 删除逻辑网络：仅允许在无成员且 profile 已禁用时执行。
   * 清理覆盖隧道分配、网络地图渲染、中继绑定、sidecar 期望态、分区状态与 profile 状态。
   */
  async function deleteNetwork(input: {
    networkId: string
  }): Promise<MNetServiceResult<{ networkId: string }>> {
    const [networkRow] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!networkRow) return err('network.not_found', 'network not found')

    const memberRows = await db
      .select()
      .from(networkMemberships)
      .where(eq(networkMemberships.networkId, input.networkId))
    if (memberRows.length > 0) {
      return err('network.members_present', 'network still has members; remove them first')
    }

    const profileState = await profileStore.getNetworkState(input.networkId)
    if (profileState && profileState.status !== 'disabled') {
      return err('network.profile_not_disabled', 'network profile must be disabled before deletion')
    }

    const memberNodeIds = memberRows.map(member => member.nodeId)
    if (memberNodeIds.length > 0) {
      await db
        .delete(mnetSidecarDesiredConfigs)
        .where(inArray(mnetSidecarDesiredConfigs.nodeId, memberNodeIds))
    }
    await db
      .delete(mnetTunnelAddressAllocations)
      .where(eq(mnetTunnelAddressAllocations.networkId, input.networkId))
    await db.delete(mnetRelayAssignments).where(eq(mnetRelayAssignments.networkId, input.networkId))
    await db
      .delete(mnetNetworkMapRenders)
      .where(eq(mnetNetworkMapRenders.networkId, input.networkId))
    await db.delete(mnetPartitionStates).where(eq(mnetPartitionStates.networkId, input.networkId))
    await db
      .delete(mnetDataPlaneOperationLocks)
      .where(eq(mnetDataPlaneOperationLocks.networkId, input.networkId))
    await db
      .delete(mnetProfileMigrations)
      .where(eq(mnetProfileMigrations.networkId, input.networkId))
    await db.delete(networkMemberships).where(eq(networkMemberships.networkId, input.networkId))
    await db
      .delete(mnetNetworkProfileStates)
      .where(eq(mnetNetworkProfileStates.networkId, input.networkId))
    await db.delete(networks).where(eq(networks.id, input.networkId))

    return ok({ networkId: input.networkId })
  }

  /**
   * 移除单个成员：清理该节点在本网络的隧道分配与 sidecar 期望态，并触发网络地图重渲染。
   * 被移除节点通过下一次网络地图同步（TTL 强制）自动拆除对应 peer 路由。
   */
  async function removeMember(input: {
    networkId: string
    nodeId: string
  }): Promise<MNetServiceResult<{ networkId: string; nodeId: string }>> {
    const [networkRow] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!networkRow) return err('network.not_found', 'network not found')

    const [membershipRow] = await db
      .select()
      .from(networkMemberships)
      .where(
        and(
          eq(networkMemberships.networkId, input.networkId),
          eq(networkMemberships.nodeId, input.nodeId)
        )
      )
      .limit(1)
    if (!membershipRow) return err('network.member_not_found', 'node is not a network member')

    // 公钥按节点维度复用（可加入多个网络），仅当节点退出所有网络时才回收
    await db
      .delete(mnetTunnelAddressAllocations)
      .where(
        and(
          eq(mnetTunnelAddressAllocations.networkId, input.networkId),
          eq(mnetTunnelAddressAllocations.nodeId, input.nodeId)
        )
      )
    await db
      .delete(mnetSidecarDesiredConfigs)
      .where(eq(mnetSidecarDesiredConfigs.nodeId, input.nodeId))
    await db
      .delete(networkMemberships)
      .where(
        and(
          eq(networkMemberships.networkId, input.networkId),
          eq(networkMemberships.nodeId, input.nodeId)
        )
      )

    const remainingMemberships = await db
      .select()
      .from(networkMemberships)
      .where(eq(networkMemberships.nodeId, input.nodeId))
    if (remainingMemberships.length === 0) {
      await db.delete(mnetNodePublicKeys).where(eq(mnetNodePublicKeys.nodeId, input.nodeId))
    }

    if (refreshNetworkMap) {
      await refreshNetworkMap(input.networkId, crypto.randomUUID())
    }

    return ok({ networkId: input.networkId, nodeId: input.nodeId })
  }

  /** 更新网络展示名等元数据；name 是身份键不可变更。 */
  async function updateNetworkMetadata(input: {
    networkId: string
    displayName?: string
  }): Promise<MNetServiceResult<MNetwork>> {
    const [networkRow] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!networkRow) return err('network.not_found', 'network not found')

    if (input.displayName !== undefined) {
      await db
        .update(networks)
        .set({ displayName: input.displayName, updatedAt: new Date() })
        .where(eq(networks.id, input.networkId))
    }

    const [updated] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, input.networkId))
      .limit(1)
    if (!updated) return err('network.not_found', 'network not found')
    return ok(mapNetwork(updated))
  }

  const networkUpdater = {
    async setProfileVersion(networkId: string, profileVersion: string) {
      await db
        .update(networks)
        .set({ profileVersion, updatedAt: new Date() })
        .where(eq(networks.id, networkId))
    }
  }

  return {
    createNetwork,
    listNetworks,
    joinNetwork,
    listMembers,
    deleteNetwork,
    removeMember,
    updateNetworkMetadata,
    networkUpdater
  }
}
