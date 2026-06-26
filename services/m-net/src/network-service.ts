import { and, eq } from 'drizzle-orm'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary
} from '../../../packages/contracts/src/index.ts'
import { networkMemberships, networks, nodes } from '../../../packages/db/src/schema.ts'
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
}

/**
 * 逻辑网络的创建、加入与成员查询保持在独立模块中，避免入口文件同时承载网络模型和 session 运行态。
 */
export function createNetworkService({
  db,
  profileStore,
  globalDefaultsStore
}: NetworkServiceDeps) {
  async function createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>> {
    const existing = await db.select().from(networks).where(eq(networks.name, input.name)).limit(1)
    if (existing[0]) return err('network.conflict', 'network name already exists')

    // 使用全局默认 profile，如果未配置则使用内置默认
    const defaultProfileVersion = globalDefaultsStore
      ? await globalDefaultsStore.getDefaultProfileVersion()
      : 'm-net-default@0.1.0'

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
    return ok(mapNetwork(network))
  }

  async function listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>> {
    const [networkRows, membershipRows] = await Promise.all([
      db.select().from(networks),
      db.select().from(networkMemberships)
    ])

    return ok(
      networkRows.map(network => ({
        ...mapNetwork(network),
        memberCount: membershipRows.filter(membership => membership.networkId === network.id).length
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
    networkUpdater
  }
}
