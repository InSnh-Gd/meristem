import { eq } from 'drizzle-orm'
import { nodes } from '../../../../packages/db/src/schema.ts'
import { shouldTransitionOffline, shouldTransitionOfflineOnDisconnect } from '../runtime.ts'
import { asRuntimeNode } from '../shared.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'

/** 统一处理心跳超时和连接断开导致的节点离线状态变更。 */
export async function transitionNodeOffline(
  context: Pick<AgentRuntimeContext, 'db' | 'publishEvent' | 'writeTimeline' | 'writeFull'>,
  nodeId: string,
  reason: 'heartbeat_timeout' | 'session_disconnected',
  now = new Date()
): Promise<void> {
  const [row] = await context.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!row || !shouldTransitionOfflineOnDisconnect(asRuntimeNode(row))) return
  await context.db
    .update(nodes)
    .set({ status: 'offline', reachability: 'unreachable', updatedAt: now })
    .where(eq(nodes.id, row.id))
  if (row.reachability !== 'unreachable') {
    try {
      await context.publishEvent('mnet.reachability.changed.v0', 'mnet.reachability.changed', {
        nodeId: row.id,
        previousReachability: row.reachability,
        nextReachability: 'unreachable'
      })
    } catch {
      // m-eventbus 不可用时事件发布失败不应导致 M-Net 崩溃。
    }
  }
  if (row.status !== 'offline') {
    try {
      await context.publishEvent('node.status.changed.v0', 'node.status.changed', {
        nodeId: row.id,
        previousStatus: row.status,
        nextStatus: 'offline',
        reason
      })
    } catch {
      // m-eventbus 不可用时事件发布失败不应导致 M-Net 崩溃。
    }
  }
  try {
    await context.writeTimeline(`node became offline ${row.id}`, row.id)
  } catch {
    // m-log 不可用时日志写入失败不应导致 M-Net 崩溃。
  }
  try {
    await context.writeFull('warn', `${reason} for ${row.id}`, undefined, undefined, {
      nodeId: row.id
    })
  } catch {
    // m-log 不可用时日志写入失败不应导致 M-Net 崩溃。
  }
}

/** 基于最后心跳与超时阈值扫描并回收离线 Agent 节点。 */
export async function markOfflineNodes(
  context: Pick<AgentRuntimeContext, 'db' | 'publishEvent' | 'writeTimeline' | 'writeFull'>,
  now: Date,
  timeoutMs: number
): Promise<void> {
  const rows = await context.db.select().from(nodes).where(eq(nodes.mode, 'agent'))
  for (const row of rows) {
    if (!shouldTransitionOffline(asRuntimeNode(row), now, timeoutMs)) continue
    await transitionNodeOffline(context, row.id, 'heartbeat_timeout', now)
  }
}
