import type { ServerWebSocket } from 'bun'
import { and, eq } from 'drizzle-orm'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import type {
  JoinRedeemMessage,
  MNode,
  SessionHeartbeatMessage,
  SessionLogForwardMessage,
  SessionResumeMessage
} from '../../../packages/contracts/src/index.ts'
import { nodeCredentials, nodeJoinTickets, nodes } from '../../../packages/db/src/schema.ts'
import type { AgentRuntimeContext, CredentialStore } from './agent-runtime-types.ts'
import {
  deriveHeartbeatTransition,
  joinTicketRedeemability,
  shouldTransitionOffline,
  shouldTransitionOfflineOnDisconnect
} from './runtime.ts'
import { asRuntimeNode, err, type JoinSessionData, mapNode, ok } from './shared.ts'
import type { MNetServiceResult } from './types.ts'

export function sessionNodeId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.nodeId === 'string' ? ws.data.nodeId : null
}

export function sessionId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.sessionId === 'string' ? ws.data.sessionId : null
}

/**
 * 每个 agent 节点同一时刻只保留一个活动 session；后来的连接会顶掉旧连接，避免任务被双写。
 */
export function bindSession(
  context: Pick<AgentRuntimeContext, 'activeSessions' | 'activeSessionIds'>,
  ws: ServerWebSocket<JoinSessionData>,
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
 * 运行 token 校验只依赖 PostgreSQL 中的 active 哈希记录，不信任节点自报身份或活动 session 状态本身。
 */
export async function validateNodeCredential(
  context: Pick<AgentRuntimeContext, 'db'>,
  nodeId: string,
  token: string
): Promise<boolean> {
  const [credential] = await context.db
    .select()
    .from(nodeCredentials)
    .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
    .limit(1)
  if (!credential) return false
  const tokenHash = await hashNodeToken(token)
  if (tokenHash !== credential.tokenHash) return false
  await context.db
    .update(nodeCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(nodeCredentials.id, credential.id))
  return true
}

/**
 * Join Ticket 兑换成功后，M-Net 负责为该 agent 签发运行 token；
 * token 明文只在这里返回一次，数据库只保留哈希和生命周期元数据。
 */
export async function issueRuntimeCredential(
  store: CredentialStore,
  nodeId: string
): Promise<{ token: string; issuedAt: string }> {
  const token = mintNodeToken()
  const tokenHash = await hashNodeToken(token)
  const now = new Date()
  await store
    .update(nodeCredentials)
    .set({ status: 'revoked', revokedAt: now })
    .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
  await store.insert(nodeCredentials).values({
    id: crypto.randomUUID(),
    nodeId,
    tokenHash,
    status: 'active',
    issuedAt: now
  })
  return { token, issuedAt: now.toISOString() }
}

/**
 * Join Ticket 兑换是公网 agent 首次接入的唯一入口：
 * 票据校验、节点创建、运行 token 签发和票据失效都必须在同一条边界里完成。
 */
export async function redeemJoinTicket(
  context: Pick<AgentRuntimeContext, 'db' | 'publishEvent' | 'writeTimeline'>,
  message: JoinRedeemMessage
): Promise<MNetServiceResult<{ node: MNode; runtimeToken: string; issuedAt: string }>> {
  const ticketHash = await hashNodeToken(message.ticket)

  const redeemed = await context.db.transaction(async tx => {
    const [ticketRow] = await tx
      .select()
      .from(nodeJoinTickets)
      .where(eq(nodeJoinTickets.ticketHash, ticketHash))
      .limit(1)

    if (!ticketRow) return err('node.join_ticket_invalid', 'join ticket is invalid')

    const redeemability = joinTicketRedeemability(
      {
        status: ticketRow.status as typeof ticketRow.status &
          ('active' | 'redeemed' | 'expired' | 'revoked'),
        expiresAt: ticketRow.expiresAt.toISOString()
      },
      new Date()
    )

    if (redeemability === 'expired') {
      await tx
        .update(nodeJoinTickets)
        .set({ status: 'expired' })
        .where(eq(nodeJoinTickets.id, ticketRow.id))
      return err('node.join_ticket_expired', 'join ticket is expired')
    }
    if (redeemability === 'redeemed') {
      return err('node.join_ticket_redeemed', 'join ticket has already been redeemed')
    }
    if (redeemability === 'revoked') {
      return err('node.join_ticket_revoked', 'join ticket has been revoked')
    }

    const now = new Date()
    const nodeId = crypto.randomUUID()
    await tx
      .update(nodeJoinTickets)
      .set({
        status: 'redeemed',
        redeemedAt: now
      })
      .where(and(eq(nodeJoinTickets.id, ticketRow.id), eq(nodeJoinTickets.status, 'active')))

    const [latestTicket] = await tx
      .select()
      .from(nodeJoinTickets)
      .where(eq(nodeJoinTickets.id, ticketRow.id))
      .limit(1)
    if (
      latestTicket?.status !== 'redeemed' ||
      latestTicket.redeemedAt?.getTime() !== now.getTime()
    ) {
      const latestStatus = latestTicket?.status as typeof ticketRow.status | undefined
      if (latestStatus === 'expired') {
        return err('node.join_ticket_expired', 'join ticket is expired')
      }
      if (latestStatus === 'revoked') {
        return err('node.join_ticket_revoked', 'join ticket has been revoked')
      }
      if (latestStatus === 'redeemed') {
        return err('node.join_ticket_redeemed', 'join ticket has already been redeemed')
      }
      return err('node.join_ticket_invalid', 'join ticket is invalid')
    }

    await tx.insert(nodes).values({
      id: nodeId,
      kind: ticketRow.kind,
      name: ticketRow.name,
      mode: 'agent',
      status: 'joining',
      reachability: 'unknown',
      capabilities: Array.isArray(ticketRow.capabilities) ? ticketRow.capabilities.map(String) : [],
      scope: ticketRow.kind === 'leaf' ? ['restricted-api', 'restricted-interconnect'] : [],
      createdAt: now,
      updatedAt: now
    })
    const [nodeRow] = await tx.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
    if (!nodeRow) return err('node.unavailable', 'failed to create node')

    await tx
      .update(nodeJoinTickets)
      .set({ redeemedNodeId: nodeId })
      .where(eq(nodeJoinTickets.id, ticketRow.id))

    const runtimeCredential = await issueRuntimeCredential(tx, nodeId)

    return ok({
      node: mapNode(nodeRow),
      runtimeToken: runtimeCredential.token,
      issuedAt: runtimeCredential.issuedAt
    })
  })

  if (!redeemed.ok) return redeemed

  await context.publishEvent('node.registration.accepted.v0', 'node.registration.accepted', {
    nodeId: redeemed.value.node.id,
    kind: redeemed.value.node.kind,
    mode: 'agent'
  })
  await context.writeTimeline(
    `redeemed join ticket for node ${redeemed.value.node.name}`,
    redeemed.value.node.id
  )

  return redeemed
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
  context: Pick<AgentRuntimeContext, 'db' | 'publishEvent' | 'writeTimeline'>,
  nodeId: string,
  heartbeat: SessionHeartbeatMessage
): Promise<MNetServiceResult<void>> {
  const [nodeRow] = await context.db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (nodeRow?.mode !== 'agent') return err('node.not_found', 'node not found')

  const transition = deriveHeartbeatTransition(asRuntimeNode(nodeRow), heartbeat)
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

  if (transition.reachabilityChanged) {
    await context.publishEvent('mnet.reachability.changed.v0', 'mnet.reachability.changed', {
      nodeId,
      previousReachability: nodeRow.reachability,
      nextReachability: transition.nextReachability
    })
    await context.writeTimeline(`node became reachable ${nodeId}`, nodeId)
  }

  if (transition.statusChanged) {
    await context.publishEvent('node.status.changed.v0', 'node.status.changed', {
      nodeId,
      previousStatus: nodeRow.status,
      nextStatus: transition.nextStatus,
      reason: 'heartbeat_reported'
    })
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
  await context.writeFull(message.level, message.message, message.correlationId, message.traceId, {
    nodeId,
    channel: 'session.log.forward',
    timestamp: message.timestamp,
    ...(message.payload === undefined ? {} : { payload: message.payload })
  })
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
    await context.publishEvent('mnet.reachability.changed.v0', 'mnet.reachability.changed', {
      nodeId: row.id,
      previousReachability: row.reachability,
      nextReachability: 'unreachable'
    })
  }

  if (row.status !== 'offline') {
    await context.publishEvent('node.status.changed.v0', 'node.status.changed', {
      nodeId: row.id,
      previousStatus: row.status,
      nextStatus: 'offline',
      reason
    })
  }

  await context.writeTimeline(`node became offline ${row.id}`, row.id)
  await context.writeFull('warn', `${reason} for ${row.id}`, undefined, undefined, {
    nodeId: row.id
  })
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
