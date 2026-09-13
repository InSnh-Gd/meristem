import { eq } from 'drizzle-orm'
import type { SessionHeartbeatMessage } from '../../../../packages/contracts/src/index.ts'
import { nodes } from '../../../../packages/db/src/schema.ts'
import {
  deriveHeartbeatTransition,
  deriveRecoveryCompletionEvidence,
  isHeartbeatStatusSuppressed
} from '../runtime.ts'
import { asRuntimeNode, err, ok } from '../shared.ts'
import type { MNetServiceResult } from '../types.ts'

type NodeRow = typeof nodes.$inferSelect
type NodeUpdate = Partial<typeof nodes.$inferInsert>

/** 心跳处理所需的最小数据库、事件与日志依赖。 */
export type HeartbeatRuntimeContext = {
  db: {
    select(): {
      from(table: typeof nodes): {
        where(condition: unknown): {
          limit(count: number): Promise<NodeRow[]>
        }
      }
    }
    update(table: typeof nodes): {
      set(values: NodeUpdate): {
        where(condition: unknown): Promise<unknown>
      }
    }
  }
  publishEvent(
    subject: string,
    type: string,
    payload: unknown,
    correlationId?: string,
    traceId?: string
  ): Promise<void>
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void>
  writeAudit(
    resource: string,
    action: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void>
}

/** 以心跳为节点在线状态的唯一权威驱动，处理恢复、事件和审计。 */
export async function applyHeartbeat(
  context: HeartbeatRuntimeContext,
  nodeId: string,
  heartbeat: SessionHeartbeatMessage
): Promise<MNetServiceResult<void>> {
  const [nodeRow] = await context.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (nodeRow?.mode !== 'agent') return err('node.not_found', 'node not found')
  const runtimeNode = asRuntimeNode(nodeRow)
  if (isHeartbeatStatusSuppressed(runtimeNode)) {
    await context.db
      .update(nodes)
      .set({
        lastSeenAt: new Date(heartbeat.timestamp),
        agentVersion: heartbeat.agentVersion,
        updatedAt: new Date()
      })
      .where(eq(nodes.id, nodeId))
    try {
      await context.writeFull(
        'info',
        `suppressed heartbeat status update for administratively controlled node ${nodeId}`,
        undefined,
        undefined,
        { nodeId, status: nodeRow.status, reportedStatus: heartbeat.reportedStatus }
      )
    } catch {
      // m-log 不可用时 heartbeat 抑制日志失败不能影响运行态协议。
    }
    return ok(undefined)
  }
  const transition = deriveHeartbeatTransition(runtimeNode, heartbeat)
  const recoveryCompletion = deriveRecoveryCompletionEvidence(runtimeNode, heartbeat, transition)
  await context.db
    .update(nodes)
    .set({
      status: transition.nextStatus,
      reachability: transition.nextReachability,
      lastSeenAt: new Date(transition.nextLastSeenAt),
      agentVersion: transition.nextAgentVersion,
      updatedAt: new Date()
    })
    .where(eq(nodes.id, nodeId))
  try {
    if (transition.reachabilityChanged) {
      await context.publishEvent('mnet.reachability.changed.v0', 'mnet.reachability.changed', {
        nodeId,
        previousReachability: nodeRow.reachability,
        nextReachability: transition.nextReachability
      })
      await context.writeTimeline(`node became reachable ${nodeId}`, nodeId)
    }
    if (transition.statusChanged) {
      if (recoveryCompletion) {
        await context.writeAudit(`node:${nodeId}`, 'node:recover-completed', undefined, undefined, {
          previousStatus: recoveryCompletion.previousStatus,
          nextStatus: recoveryCompletion.nextStatus,
          heartbeatTimestamp: recoveryCompletion.heartbeatTimestamp,
          agentVersion: recoveryCompletion.agentVersion
        })
      }
      await context.publishEvent('node.status.changed.v0', 'node.status.changed', {
        nodeId,
        previousStatus: nodeRow.status,
        nextStatus: transition.nextStatus,
        reason: 'heartbeat_reported'
      })
      if (recoveryCompletion) {
        await context.writeTimeline(
          `node recovery completed as ${recoveryCompletion.nextStatus} ${nodeId}`,
          nodeId
        )
      }
    }
  } catch (error) {
    if (recoveryCompletion) {
      await context.db
        .update(nodes)
        .set({
          status: recoveryCompletion.previousStatus,
          reachability: nodeRow.reachability,
          lastSeenAt: nodeRow.lastSeenAt,
          agentVersion: nodeRow.agentVersion,
          updatedAt: new Date()
        })
        .where(eq(nodes.id, nodeId))
    }
    throw error
  }
  return ok(undefined)
}
