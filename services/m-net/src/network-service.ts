import { and, eq, ne } from 'drizzle-orm'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary
} from '../../../packages/contracts/src/index.ts'
import {
  mnetClosedLoopFacts,
  mnetDataPlaneOperationLocks,
  mnetNetworkMapRenders,
  mnetNetworkProfileStates,
  mnetNodePublicKeys,
  mnetPartitionStates,
  mnetProfileMigrations,
  mnetProfileSwitchBatchMembers,
  mnetProfileTransitions,
  mnetRelayAssignments,
  mnetSidecarDesiredConfigs,
  mnetSuspendedOperations,
  mnetTunnelAddressAllocations,
  networkMemberships,
  networks,
  nodes
} from '../../../packages/db/src/schema.ts'
import { isNodeExcludedFromPeerPaths } from './agent/node-control-state-machine.ts'
import type { MNetDb } from './clients.ts'
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
    return listNetworkMembers(db, input)
  }

  /**
   * 删除逻辑网络：仅允许在无成员、profile 已禁用、且无留存台账引用时执行。
   * 前置检查与级联清理在同一事务内：中途失败整体回滚，不留半删状态。
   * 运营态数据（隧道分配/中继/地图渲染/分区/操作锁/迁移/过渡/已终结挂起操作/成员/状态行）级联清理；
   * closed-loop facts、profile switch 成员关系与未终结挂起操作属于留存台账，存在即 409 拒绝。
   * network.not_found 只表示「本事务从未见到行」；mnet.network.deleted.v0 是 at-least-once 语义，
   * 「删除已提交但发布失败」后的补发由 Core DELETE 路由把 network.not_found 收敛为幂等成功完成。
   */
  async function deleteNetwork(input: {
    networkId: string
  }): Promise<MNetServiceResult<{ networkId: string }>> {
    return db.transaction(async tx => {
      // 对 networks 行加 FOR UPDATE：它与子表 INSERT 为满足外键而取的 KEY SHARE 互斥，
      // 因此并发 joinNetwork（插 network_memberships）会阻塞到本事务结束，不会在
      // 成员门禁读完之后插入成员、又被下面的级联删除静默抹掉并让 join 误报成功。
      const [networkRow] = await tx
        .select()
        .from(networks)
        .where(eq(networks.id, input.networkId))
        .limit(1)
        .for('update')
      if (!networkRow) return err('network.not_found', 'network not found')

      const memberRows = await tx
        .select()
        .from(networkMemberships)
        .where(eq(networkMemberships.networkId, input.networkId))
      if (memberRows.length > 0) {
        return err('network.members_present', 'network still has members; remove them first')
      }

      // 权威 profile 门禁在事务内直读状态表（生产 profileStore 与本事务同库，
      // 事务外读会留下并发解禁的 TOCTOU 窗口）；行缺失放行：profile 状态行经
      // FK 挂在 networks 上，网络存在而状态行缺失即从未启用，与旧语义一致。
      const [profileRow] = await tx
        .select({ status: mnetNetworkProfileStates.status })
        .from(mnetNetworkProfileStates)
        .where(eq(mnetNetworkProfileStates.networkId, input.networkId))
        .limit(1)
      if (profileRow && profileRow.status !== 'disabled') {
        return err(
          'network.profile_not_disabled',
          'network profile must be disabled before deletion'
        )
      }

      // 留存台账门禁：closed-loop 事实与 profile switch 子表按 network_id 外键挂在
      // networks 上，但它们是运维/审计账本，不做级联销毁——存在引用即拒绝删除（409），
      // 由操作者显式处置；这与改前「FK 违例 500」相比是把同一冲突变成 typed 拒绝。
      const [factRow] = await tx
        .select({ factId: mnetClosedLoopFacts.factId })
        .from(mnetClosedLoopFacts)
        .where(eq(mnetClosedLoopFacts.networkId, input.networkId))
        .limit(1)
      if (factRow) {
        return err(
          'network.closed_loop_facts_present',
          'network still has closed-loop facts; prune them before deletion'
        )
      }
      const [batchMemberRow] = await tx
        .select({ operationId: mnetProfileSwitchBatchMembers.operationId })
        .from(mnetProfileSwitchBatchMembers)
        .where(eq(mnetProfileSwitchBatchMembers.networkId, input.networkId))
        .limit(1)
      if (batchMemberRow) {
        return err(
          'network.switch_membership_present',
          'network still belongs to a profile switch operation; it cannot be deleted'
        )
      }

      // 挂起操作台账（break-glass 恢复路径）只允许清理已终结（resumed）的行；
      // suspended / rejected / expired / resume_failed 都属于未决或待追账状态，存在即拒绝删除。
      const [suspendedRow] = await tx
        .select({ id: mnetSuspendedOperations.id })
        .from(mnetSuspendedOperations)
        .where(
          and(
            eq(mnetSuspendedOperations.networkId, input.networkId),
            ne(mnetSuspendedOperations.status, 'resumed')
          )
        )
        .limit(1)
      if (suspendedRow) {
        return err(
          'network.operation_suspended',
          'network has a non-terminal suspended policy operation; resolve or prune its ledger before deletion'
        )
      }

      // 运营态数据按网络生命周期归属，随 networks 行级联清理（含迁移与过渡历史）；
      // 留存台账（closed-loop facts、switch 成员关系、未终结挂起操作）只门禁不销毁。
      await tx
        .delete(mnetTunnelAddressAllocations)
        .where(eq(mnetTunnelAddressAllocations.networkId, input.networkId))
      await tx
        .delete(mnetRelayAssignments)
        .where(eq(mnetRelayAssignments.networkId, input.networkId))
      await tx
        .delete(mnetNetworkMapRenders)
        .where(eq(mnetNetworkMapRenders.networkId, input.networkId))
      await tx.delete(mnetPartitionStates).where(eq(mnetPartitionStates.networkId, input.networkId))
      await tx
        .delete(mnetDataPlaneOperationLocks)
        .where(eq(mnetDataPlaneOperationLocks.networkId, input.networkId))
      await tx
        .delete(mnetProfileMigrations)
        .where(eq(mnetProfileMigrations.networkId, input.networkId))
      await tx
        .delete(mnetProfileTransitions)
        .where(eq(mnetProfileTransitions.networkId, input.networkId))
      // 挂起操作台账只清理已终结（resumed）且门禁已确认存在的行。谓词必须与门禁同界：
      // 无 status 条件的整表删除会在「并发插入一条非终结挂起操作」时把它一并抹掉，
      // 违反上面「存在即拒绝」的留存语义；限定 resumed 后该并发行会残留并让
      // delete(networks) 触发 FK 拒绝，整事务回滚而不销毁台账。
      await tx
        .delete(mnetSuspendedOperations)
        .where(
          and(
            eq(mnetSuspendedOperations.networkId, input.networkId),
            eq(mnetSuspendedOperations.status, 'resumed')
          )
        )
      await tx.delete(networkMemberships).where(eq(networkMemberships.networkId, input.networkId))
      await tx
        .delete(mnetNetworkProfileStates)
        .where(eq(mnetNetworkProfileStates.networkId, input.networkId))
      await tx.delete(networks).where(eq(networks.id, input.networkId))
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
