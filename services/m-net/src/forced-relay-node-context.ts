import { and, eq } from 'drizzle-orm'
import {
  mnetNetworkProfileStates,
  networkMemberships,
  nodes
} from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import type { ForcedRelayNodeContext } from './types.ts'

// 单一定义源在 types.ts 叶模块（deps.ts 需要引用它且不得反向依赖本文件）；
// 此处 re-export 保持既有 `from './forced-relay-node-context.ts'` 消费点兼容。
export type { ForcedRelayNodeContext } from './types.ts'

function asCapabilities(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * 将 forced-relay proof path 需要的节点上下文收敛到单一查询，避免工作流散落 Drizzle 细节。
 */
export function createDbForcedRelayNodeContext(db: MNetDb) {
  return async function describeForcedRelayNode(
    nodeId: string
  ): Promise<ForcedRelayNodeContext | null> {
    const [row] = await db
      .select({
        nodeId: nodes.id,
        nodeKind: nodes.kind,
        status: nodes.status,
        reachability: nodes.reachability,
        capabilities: nodes.capabilities,
        networkId: networkMemberships.networkId,
        networkProfileVersion: mnetNetworkProfileStates.profileVersion
      })
      .from(nodes)
      .leftJoin(
        networkMemberships,
        and(eq(networkMemberships.nodeId, nodes.id), eq(networkMemberships.status, 'joined'))
      )
      .leftJoin(
        mnetNetworkProfileStates,
        eq(mnetNetworkProfileStates.networkId, networkMemberships.networkId)
      )
      .where(eq(nodes.id, nodeId))
      .limit(1)

    if (!row) return null
    if (row.nodeKind !== 'stem' && row.nodeKind !== 'leaf') return null

    return {
      nodeId: row.nodeId,
      nodeKind: row.nodeKind,
      status: row.status,
      reachability: row.reachability,
      capabilities: asCapabilities(row.capabilities),
      networkId: row.networkId,
      networkProfileVersion: row.networkProfileVersion
    }
  }
}
