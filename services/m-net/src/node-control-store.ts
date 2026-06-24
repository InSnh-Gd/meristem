import { and, eq, ne } from 'drizzle-orm'
import type { MNode, NodeKind, NodeStatus } from '../../../packages/contracts/src/index.ts'
import { networkMemberships, nodes } from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import { mapNode, membershipModeFor } from './shared.ts'

export type NodeControlRecord = MNode

export type NodeControlStore = {
  get(nodeId: string): Promise<NodeControlRecord | null>
  updateStatus(nodeId: string, nextStatus: NodeStatus): Promise<NodeControlRecord | null>
  listMemberships(nodeId: string): Promise<readonly { networkId: string }[]>
  listNetworksWithoutSiblingStem(input: { nodeId: string; networkIds: readonly string[] }): Promise<readonly string[]>
  updateRole(nodeId: string, nextKind: NodeKind): Promise<NodeControlRecord | null>
}

/**
 * 节点行政控制的 PostgreSQL 适配器；只暴露读取和状态更新，避免工作流直接拼 SQL。
 */
export function createDbNodeControlStore(db: MNetDb): NodeControlStore {
  return {
    async get(nodeId) {
      const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
      return row ? mapNode(row) : null
    },
    async updateStatus(nodeId, nextStatus) {
      await db
        .update(nodes)
        .set({
          status: nextStatus,
          updatedAt: new Date()
        })
        .where(eq(nodes.id, nodeId))
      const [updated] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
      return updated ? mapNode(updated) : null
    },
    async listMemberships(nodeId) {
      return db
        .select({ networkId: networkMemberships.networkId })
        .from(networkMemberships)
        .where(eq(networkMemberships.nodeId, nodeId))
    },
    async listNetworksWithoutSiblingStem(input) {
      if (input.networkIds.length === 0) return []
      const networkIdSet = new Set(input.networkIds)
      const rows = await db
        .select({ networkId: networkMemberships.networkId })
        .from(networkMemberships)
        .innerJoin(nodes, eq(networkMemberships.nodeId, nodes.id))
        .where(and(ne(networkMemberships.nodeId, input.nodeId), eq(nodes.kind, 'stem')))
      const networksWithSiblingStem = new Set(
        rows.filter(row => networkIdSet.has(row.networkId)).map(row => row.networkId)
      )
      return input.networkIds.filter(networkId => !networksWithSiblingStem.has(networkId))
    },
    async updateRole(nodeId, nextKind) {
      const now = new Date()
      await db
        .update(nodes)
        .set({ kind: nextKind, updatedAt: now })
        .where(eq(nodes.id, nodeId))
      await db
        .update(networkMemberships)
        .set({ membershipMode: membershipModeFor(nextKind), updatedAt: now })
        .where(eq(networkMemberships.nodeId, nodeId))
      const [updated] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
      return updated ? mapNode(updated) : null
    }
  }
}

/**
 * 内存节点控制存储，用于工作流与路由测试中的无副作用验证。
 */
export function createInMemoryNodeControlStore(initialNodes: readonly NodeControlRecord[]): NodeControlStore & {
  __testing: {
    snapshot(nodeId: string): NodeControlRecord | null
    joinNetwork(input: { networkId: string; nodeId: string; nodeKind: NodeKind }): void
    memberships(nodeId: string): readonly {
      networkId: string
      nodeId: string
      nodeKind: NodeKind
      membershipMode: 'full' | 'restricted'
    }[]
  }
} {
  const records = new Map(initialNodes.map(node => [node.id, { ...node }]))
  const memberships: Array<{
    networkId: string
    nodeId: string
    nodeKind: NodeKind
    membershipMode: 'full' | 'restricted'
  }> = []

  return {
    __testing: {
      snapshot(nodeId) {
        const node = records.get(nodeId)
        return node ? { ...node } : null
      },
      joinNetwork(input) {
        memberships.push({
          networkId: input.networkId,
          nodeId: input.nodeId,
          nodeKind: input.nodeKind,
          membershipMode: membershipModeFor(input.nodeKind)
        })
      },
      memberships(nodeId) {
        return memberships
          .filter(membership => membership.nodeId === nodeId)
          .map(membership => ({ ...membership }))
      }
    },
    async get(nodeId) {
      const node = records.get(nodeId)
      return node ? { ...node } : null
    },
    async updateStatus(nodeId, nextStatus) {
      const node = records.get(nodeId)
      if (!node) return null
      const updated = { ...node, status: nextStatus }
      records.set(nodeId, updated)
      return { ...updated }
    },
    async listMemberships(nodeId) {
      return memberships
        .filter(membership => membership.nodeId === nodeId)
        .map(({ networkId }) => ({ networkId }))
    },
    async listNetworksWithoutSiblingStem(input) {
      const networkIdSet = new Set(input.networkIds)
      const networksWithSiblingStem = new Set(
        memberships
          .filter(
            membership =>
              membership.nodeId !== input.nodeId &&
              membership.nodeKind === 'stem' &&
              networkIdSet.has(membership.networkId)
          )
          .map(membership => membership.networkId)
      )
      return input.networkIds.filter(networkId => !networksWithSiblingStem.has(networkId))
    },
    async updateRole(nodeId, nextKind) {
      const node = records.get(nodeId)
      if (!node) return null
      const updated = { ...node, kind: nextKind }
      records.set(nodeId, updated)
      for (const membership of memberships) {
        if (membership.nodeId === nodeId) {
          membership.nodeKind = nextKind
          membership.membershipMode = membershipModeFor(nextKind)
        }
      }
      return { ...updated }
    }
  }
}
