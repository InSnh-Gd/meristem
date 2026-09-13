import { and, eq } from 'drizzle-orm'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary
} from '../../../packages/contracts/src/index.ts'
import {
  mnetNetworkEventIntents,
  mnetNodePublicKeys,
  mnetSidecarDesiredConfigs,
  mnetTunnelAddressAllocations,
  networkMemberships,
  networks,
  nodes
} from '../../../packages/db/src/schema.ts'
import { isNodeExcludedFromPeerPaths } from './agent/node-control-state-machine.ts'
import type { MNetDb } from './clients.ts'
import {
  cascadeDeleteNetworkState,
  evaluateNetworkDeletion,
  writeNetworkDeletionArtifacts
} from './data-plane/network-lifecycle-deletion.ts'
import {
  createMNetNetworkEventIntent,
  networkEventIntentRow
} from './data-plane/network-event-outbox.ts'
import type { GlobalDefaultsStore } from './profile/global-defaults-store.ts'
import type { ProfileStore } from './profile/profile-store.ts'
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
 * 列出网络成员（db-only）。抽为独立函数以便启动装配在构造 network service 之前
 * 就能把它交给数据面依赖与 map refresher，从而消除
 * 「refreshNetworkMap 需要 dataPlane → 需要 listMembers → 需要 networkService」的构造环。
 */
export async function listNetworkMembers(
  db: MNetDb,
  input: { networkId: string }
): Promise<MNetServiceResult<MNetworkMember[]>> {
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

/** 更新网络 profile 版本的 db-only 端口；抽为独立工厂以便启动装配在构造 service 之前获得它。 */
export function createNetworkUpdater(db: MNetDb) {
  return {
    async setProfileVersion(networkId: string, profileVersion: string) {
      await db
        .update(networks)
        .set({ profileVersion, updatedAt: new Date() })
        .where(eq(networks.id, networkId))
    }
  }
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
  async function createNetwork(
    input: CreateNetworkRequest & { correlationId?: string }
  ): Promise<MNetServiceResult<MNetwork>> {
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
    const intent = createMNetNetworkEventIntent(
      network.id,
      'mnet.network.created.v0',
      { networkId: network.id, name: network.name, profileVersion: network.profileVersion },
      input.correlationId ?? crypto.randomUUID(),
      now.toISOString()
    )

    // 权威网络行与事件意图同事务提交：发布失败只留下可补发的 pending intent，
    // 不会出现「网络已建但事件永久丢失」（ADR-N05）。
    await db.transaction(async tx => {
      await tx.insert(networks).values(network)
      await tx.insert(mnetNetworkEventIntents).values(networkEventIntentRow(intent))
    })
    // profile 状态是网络生命周期的从属行，失败不回滚已提交的网络行（既有语义）。
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
    correlationId?: string
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
    const membershipMode = membershipModeFor(nodeKind)
    const intent = createMNetNetworkEventIntent(
      input.networkId,
      'mnet.membership.joined.v0',
      {
        networkId: input.networkId,
        nodeId: input.nodeId,
        nodeKind,
        membershipMode
      },
      input.correlationId ?? crypto.randomUUID(),
      now.toISOString()
    )
    // 成员行与加入事件意图同事务提交（ADR-N05）。
    await db.transaction(async tx => {
      await tx.insert(networkMemberships).values({
        networkId: input.networkId,
        nodeId: input.nodeId,
        membershipMode,
        status: 'joined',
        joinedAt: now,
        updatedAt: now
      })
      await tx.insert(mnetNetworkEventIntents).values(networkEventIntentRow(intent))
    })

    return ok({
      networkId: input.networkId,
      nodeId: input.nodeId,
      nodeKind,
      membershipMode,
      status: 'joined',
      joinedAt: now.toISOString()
    })
  }

  async function listMembers(input: {
    networkId: string
  }): Promise<MNetServiceResult<MNetworkMember[]>> {
    return listNetworkMembers(db, input)
  }

  /**
   * 删除逻辑网络：仅允许在无成员、profile 已禁用、且无留存台账引用时执行。
   * 门禁、级联清理、墓碑与删除事件意图在同一事务内完成（见 network-lifecycle-deletion.ts）：
   * 中途失败整体回滚，不留半删状态，也不会出现「网络已删但删除事件丢失」。
   * 墓碑区分「删过」（幂等成功，不重复发事件）与「从未存在」（network.not_found）。
   */
  async function deleteNetwork(input: {
    networkId: string
    correlationId?: string
  }): Promise<MNetServiceResult<{ networkId: string }>> {
    return db.transaction(async tx => {
      const precondition = await evaluateNetworkDeletion(tx, input.networkId)
      if (precondition.kind === 'idempotent') return ok({ networkId: input.networkId })
      if (precondition.kind === 'failure') {
        return err(precondition.error.code, precondition.error.message)
      }
      await cascadeDeleteNetworkState(tx, input.networkId)
      await writeNetworkDeletionArtifacts(tx, input.networkId, input.correlationId)
      return ok({ networkId: input.networkId })
    })
  }

  /**
   * 移除单个成员：清理该节点在本网络的隧道分配与成员关系，并触发网络地图重渲染。
   * 前置检查与清理在同一事务内：中途失败整体回滚，不留「旧隧道分配已删、成员行还在」
   * 的重渲染分叉（成员会被重新分配 IP）或永不回收的 sidecar/公钥残留。
   * sidecar 期望态与公钥按节点维度存储（sidecar 表主键仅 node_id），仅当该节点已退出**所有**
   * 网络时才回收——否则会误删它在其它网络的期望态。
   * 被移除节点通过下一次网络地图同步（TTL 强制）自动拆除对应 peer 路由。
   */
  async function removeMember(input: {
    networkId: string
    nodeId: string
    /** 调用方经 header 透传的链路 id；缺失时为兼容旧调用方而本地补值。 */
    correlationId?: string
  }): Promise<MNetServiceResult<{ networkId: string; nodeId: string }>> {
    const result = await db.transaction(async tx => {
      // 与 deleteNetwork 同锁序：对 networks 行加 FOR UPDATE，与并发 joinNetwork 插入
      // membership 为满足外键取的 KEY SHARE 互斥，保证「存在性检查 → 剩余成员读数 →
      // 条件回收」在同一快照内完成，不与并发加网交错。
      const [networkRow] = await tx
        .select()
        .from(networks)
        .where(eq(networks.id, input.networkId))
        .limit(1)
        .for('update')
      if (!networkRow) return err('network.not_found', 'network not found')

      const [membershipRow] = await tx
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

      await tx
        .delete(mnetTunnelAddressAllocations)
        .where(
          and(
            eq(mnetTunnelAddressAllocations.networkId, input.networkId),
            eq(mnetTunnelAddressAllocations.nodeId, input.nodeId)
          )
        )
      await tx
        .delete(networkMemberships)
        .where(
          and(
            eq(networkMemberships.networkId, input.networkId),
            eq(networkMemberships.nodeId, input.nodeId)
          )
        )

      // 公钥与 sidecar 期望态都按节点维度存储（sidecar 表主键只有 node_id），
      // 仅当该节点已不隶属任何网络时才回收；否则会误删它在其它网络/期望态的记录。
      const remainingMemberships = await tx
        .select()
        .from(networkMemberships)
        .where(eq(networkMemberships.nodeId, input.nodeId))
      if (remainingMemberships.length === 0) {
        await tx
          .delete(mnetSidecarDesiredConfigs)
          .where(eq(mnetSidecarDesiredConfigs.nodeId, input.nodeId))
        await tx.delete(mnetNodePublicKeys).where(eq(mnetNodePublicKeys.nodeId, input.nodeId))
      }

      // 成员移除事件意图与清理同事务提交（ADR-N05）。
      const removedAt = new Date()
      const intent = createMNetNetworkEventIntent(
        input.networkId,
        'mnet.membership.removed.v0',
        { networkId: input.networkId, nodeId: input.nodeId },
        input.correlationId ?? crypto.randomUUID(),
        removedAt.toISOString()
      )
      await tx.insert(mnetNetworkEventIntents).values(networkEventIntentRow(intent))

      return ok({ networkId: input.networkId, nodeId: input.nodeId })
    })

    // refresher 走 materialize/HTTP/eventbus，必须在事务提交之后调用，不能持锁等待外部服务。
    // 网络已无成员时 refresher 自身按 no-op 处理（materializeMembers 空成员会返回
    // 409 network.members_missing）。
    // correlationId 由 Core 经 x-correlation-id header 透传，使 map 刷新与上游审计/事件同链路；
    // 直接调用该端口（无 header）时回退为本地生成，保持旧调用方可用。
    if (result.ok && refreshNetworkMap) {
      await refreshNetworkMap(input.networkId, input.correlationId ?? crypto.randomUUID())
    }

    return result
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

  const networkUpdater = createNetworkUpdater(db)

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
