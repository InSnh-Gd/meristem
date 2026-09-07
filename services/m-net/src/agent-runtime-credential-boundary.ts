import { and, eq } from 'drizzle-orm'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import type { JoinRedeemMessage, MNode } from '../../../packages/contracts/src/index.ts'
import { nodeCredentials, nodeJoinTickets, nodes } from '../../../packages/db/src/schema.ts'
import type { AgentRuntimeContext, CredentialStore } from './agent-runtime-types.ts'
import { joinTicketRedeemability } from './runtime.ts'
import { err, mapNode, ok } from './shared.ts'
import type { MNetServiceResult } from './types.ts'

type NodeCredentialRow = typeof nodeCredentials.$inferSelect
type NodeCredentialUpdate = Partial<typeof nodeCredentials.$inferInsert>

/**
 * Agent 凭证与 Join Ticket 信任边界：运行 token 校验、签发与 Join Ticket 兑换。
 * 这里是公网 agent 首次接入与凭证生命周期的唯一权威路径；
 * session 绑定与心跳等运行时编排见 agent-runtime-session-lifecycle.ts。
 */

export type RuntimeCredentialContext = {
  db: {
    select(): {
      from(table: typeof nodeCredentials): {
        where(condition: unknown): {
          limit(count: number): Promise<NodeCredentialRow[]>
        }
      }
    }
    update(table: typeof nodeCredentials): {
      set(values: NodeCredentialUpdate): {
        where(condition: unknown): Promise<unknown>
      }
    }
  }
}

/**
 * 运行 token 校验只依赖 PostgreSQL 中的 active 哈希记录，不信任节点自报身份或活动 session 状态本身。
 */
export async function validateNodeCredential(
  context: RuntimeCredentialContext,
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
      .set({
        status: 'redeemed',
        redeemedAt: now,
        redeemedNodeId: nodeId
      })
      .where(and(eq(nodeJoinTickets.id, ticketRow.id), eq(nodeJoinTickets.status, 'active')))
      .returning({ id: nodeJoinTickets.id })

    if (updateResult.length === 0) {
      await tx.delete(nodes).where(eq(nodes.id, nodeId))
    }

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
