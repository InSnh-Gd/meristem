import { and, eq } from 'drizzle-orm'
import { hashNodeToken } from '../../../packages/auth/src/index.ts'
import type {
  JoinRedeemMessage,
  MNode,
  SessionResumeMessage
} from '../../../packages/contracts/src/index.ts'
import { nodeJoinTickets, nodes } from '../../../packages/db/src/schema.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'
import {
  issueRuntimeCredential,
  validateNodeCredential
} from './agent-runtime-session-credentials.ts'
import { joinTicketRedeemability } from './runtime.ts'
import { err, mapNode, ok } from './shared.ts'
import type { MNetServiceResult } from './types.ts'

/** 兑换 Join Ticket、创建节点并签发运行 token。 */
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
    const updateResult = await tx
      .update(nodeJoinTickets)
      .set({ status: 'redeemed', redeemedAt: now, redeemedNodeId: nodeId })
      .where(and(eq(nodeJoinTickets.id, ticketRow.id), eq(nodeJoinTickets.status, 'active')))
      .returning({ id: nodeJoinTickets.id })
    if (updateResult.length === 0) await tx.delete(nodes).where(eq(nodes.id, nodeId))
    const [latestTicket] = await tx
      .select()
      .from(nodeJoinTickets)
      .where(eq(nodeJoinTickets.id, ticketRow.id))
      .limit(1)
    if (
      updateResult.length === 0 ||
      latestTicket?.status !== 'redeemed' ||
      latestTicket.redeemedNodeId !== nodeId
    ) {
      const latestStatus = latestTicket?.status as typeof ticketRow.status | undefined
      if (latestStatus === 'expired')
        return err('node.join_ticket_expired', 'join ticket is expired')
      if (latestStatus === 'revoked')
        return err('node.join_ticket_revoked', 'join ticket has been revoked')
      if (latestStatus === 'redeemed') {
        return err('node.join_ticket_redeemed', 'join ticket has already been redeemed')
      }
      return err('node.join_ticket_invalid', 'join ticket is invalid')
    }
    const [nodeRow] = await tx.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
    if (!nodeRow) return err('node.unavailable', 'failed to create node')
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

/** 恢复已存在的 Agent 节点 session，不重放 Join Ticket 或创建节点。 */
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
