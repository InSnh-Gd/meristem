import type { ServerWebSocket } from 'bun'
import { eq } from 'drizzle-orm'
import type {
  MNode,
  SessionHeartbeatMessage,
  SessionLogForwardMessage,
  SessionResumeMessage
} from '../../../packages/contracts/src/index.ts'
import { nodes } from '../../../packages/db/src/schema.ts'
import {
  issueRuntimeCredential,
  type RuntimeCredentialContext,
  redeemJoinTicket,
  validateNodeCredential
} from './agent-runtime-credential-boundary.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'
import {
  deriveHeartbeatTransition,
  deriveRecoveryCompletionEvidence,
  isHeartbeatStatusSuppressed,
  shouldTransitionOffline,
  shouldTransitionOfflineOnDisconnect
} from './runtime.ts'
import { asRuntimeNode, err, type JoinSessionData, mapNode, ok } from './shared.ts'
import type { MNetServiceResult } from './types.ts'

// Agent 凭证与 Join Ticket 信任边界在 agent-runtime-credential-boundary.ts；
// 这里保留 re-export 以维持既有导入路径（agent-runtime-websocket / node-runtime / 契约测试）。
export {
  issueRuntimeCredential,
  type RuntimeCredentialContext,
  redeemJoinTicket,
  validateNodeCredential
}

type NodeRow = typeof nodes.$inferSelect
type NodeUpdate = Partial<typeof nodes.$inferInsert>

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

export function sessionNodeId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.nodeId === 'string' ? ws.data.nodeId : null
}

export function sessionId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.sessionId === 'string' ? ws.data.sessionId : null
}

/**
 * 每个 agent 节点同一时刻只保留一个活动 session；后来的连接会顶掉旧连接，避免任务被双写。
 */
export function bindSession<
  TSocket extends Pick<ServerWebSocket<JoinSessionData>, 'data' | 'close'>
>(
  context: {
    activeSessions: Map<string, TSocket>
    activeSessionIds: Map<string, string>
  },
  ws: TSocket,
  nodeId: string
): string {
  const previous = context.activeSessions.get(nodeId)
  const nextSessionId = crypto.randomUUID()
  ws.data.nodeId = nodeId
  ws.data.sessionId = nextSessionId
  context.activeSessions.set(nodeId, ws)
  context.activeSessionIds.set(nodeId, nextSessionId)
  if (previous && previous !== ws) previous.close(4001, 'superseded')
  return nextSessionId
}

/**
 * resume 只恢复已存在 agent 节点的 session，不会重放 Join Ticket，也不会重新创建节点记录。
 */
export async function resumeSession(
  context: Pick<AgentRuntimeContext, 'db' | 'writeAudit'>,
  message: SessionResumeMessage
): Promise<MNetServiceResult<MNode>> {
  const [nodeRow] = await context.db
    .select()
    .from(nodes)
    .where(eq(nodes.id, message.nodeId))
    .limit(1)
  if (nodeRow?.mode !== 'agent') return err('node.not_found', 'node not found')
  const validCredential = await validateNodeCredential(context, message.nodeId, message.token)
  if (!validCredential) {
    await context.writeAudit(
      `node:${message.nodeId}`,
      'node:resume-token-invalid',
      undefined,
      undefined,
      {
        channel: 'session.resume'
      }
    )
    return err('nodeagent.invalid_token', 'node runtime token is invalid')
  }
  return ok(mapNode(nodeRow))
}

/**
 * heartbeat 是 agent 在线状态的唯一权威驱动：
 * session 存活不等于节点可达，节点状态必须由心跳和超时规则共同决定。
 */
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
        {
          nodeId,
          status: nodeRow.status,
          reportedStatus: heartbeat.reportedStatus
        }
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

/**
 * agent 通过 session.forward 送来的日志会在 M-Net 侧补上节点身份和通道来源，再统一落到 M-Log。
 */
export async function forwardLog(
  context: Pick<AgentRuntimeContext, 'writeFull'>,
  nodeId: string,
  message: SessionLogForwardMessage
): Promise<void> {
  try {
    await context.writeFull(
      message.level,
      message.message,
      message.correlationId,
      message.traceId,
      {
        nodeId,
        channel: 'session.log.forward',
        timestamp: message.timestamp,
        ...(message.payload === undefined ? {} : { payload: message.payload })
      }
    )
  } catch {
    // m-log 不可用时日志转发失败不应导致 M-Net 崩溃，特别是启动阶段竞态
  }
}

/**
 * offline 迁移统一走一条路径，保证 heartbeat timeout 与 socket disconnect
 * 在数据库、事件和日志上的表现一致且可预测。
 */
export async function transitionNodeOffline(
  context: Pick<AgentRuntimeContext, 'db' | 'publishEvent' | 'writeTimeline' | 'writeFull'>,
  nodeId: string,
  reason: 'heartbeat_timeout' | 'session_disconnected',
  now = new Date()
): Promise<void> {
  const [row] = await context.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!row) return
  if (!shouldTransitionOfflineOnDisconnect(asRuntimeNode(row))) return

  await context.db
    .update(nodes)
    .set({
      status: 'offline',
      reachability: 'unreachable',
      updatedAt: now
    })
    .where(eq(nodes.id, row.id))

  if (row.reachability !== 'unreachable') {
    try {
      await context.publishEvent('mnet.reachability.changed.v0', 'mnet.reachability.changed', {
        nodeId: row.id,
        previousReachability: row.reachability,
        nextReachability: 'unreachable'
      })
    } catch {
      // m-eventbus 不可用时事件发布失败不应导致 M-Net 崩溃
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
      // m-eventbus 不可用时事件发布失败不应导致 M-Net 崩溃
    }
  }

  try {
    await context.writeTimeline(`node became offline ${row.id}`, row.id)
  } catch {
    // m-log 不可用时日志写入失败不应导致 M-Net 崩溃
  }
  try {
    await context.writeFull('warn', `${reason} for ${row.id}`, undefined, undefined, {
      nodeId: row.id
    })
  } catch {
    // m-log 不可用时日志写入失败不应导致 M-Net 崩溃
  }
}

/**
 * 离线扫描通过“最后心跳时间 + 超时阈值”回收 agent，避免仅依赖 WebSocket close 造成状态漂移。
 */
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
