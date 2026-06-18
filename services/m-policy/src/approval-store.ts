import { eq } from 'drizzle-orm'
import type { ActorId, ApprovalStatus, PolicyApproval, PolicyApprovalVote } from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { policyApprovals, policyApprovalVotes } from '../../../packages/db/src/schema.ts'
import type { ApprovalStore } from './approval-schemas.ts'

export function createPgApprovalStore(db: MeristemDb): ApprovalStore {
  return {
    async createApproval(input) {
      const now = new Date()
      const row = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        originService: input.originService,
        operationId: input.operationId,
        requestedBy: input.requestedBy,
        requiredAction: input.requiredAction,
        status: 'pending',
        quorumRequired: input.quorumRequired,
        expiresAt: new Date(input.expiresAt),
        createdAt: now,
        updatedAt: now
      }
      await db.insert(policyApprovals).values(row)
      return {
        id: row.id,
        policyDecisionId: row.policyDecisionId,
        originService: row.originService as PolicyApproval['originService'],
        operationId: row.operationId,
        requestedBy: row.requestedBy as ActorId,
        requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
        status: row.status as ApprovalStatus,
        quorumRequired: row.quorumRequired,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }
    },
    async listApprovals(status) {
      const query = status
        ? db.select().from(policyApprovals).where(eq(policyApprovals.status, status))
        : db.select().from(policyApprovals)
      const rows = await query
      return rows.map(row => ({
        id: row.id,
        policyDecisionId: row.policyDecisionId,
        originService: row.originService as PolicyApproval['originService'],
        operationId: row.operationId,
        requestedBy: row.requestedBy as ActorId,
        requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
        status: row.status as ApprovalStatus,
        quorumRequired: row.quorumRequired,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {})
      }))
    },
    async getApproval(id) {
      const [row] = await db.select().from(policyApprovals).where(eq(policyApprovals.id, id)).limit(1)
      if (!row) return null
      return {
        id: row.id,
        policyDecisionId: row.policyDecisionId,
        originService: row.originService as PolicyApproval['originService'],
        operationId: row.operationId,
        requestedBy: row.requestedBy as ActorId,
        requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
        status: row.status as ApprovalStatus,
        quorumRequired: row.quorumRequired,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {})
      }
    },
    async getVotes(approvalId) {
      const rows = await db
        .select()
        .from(policyApprovalVotes)
        .where(eq(policyApprovalVotes.approvalId, approvalId))
      return rows.map(row => ({
        id: row.id,
        approvalId: row.approvalId,
        actor: row.actor as ActorId,
        vote: row.vote as PolicyApprovalVote['vote'],
        ...(row.reason ? { reason: row.reason } : {}),
        createdAt: row.createdAt.toISOString()
      }))
    },
    async addVote(approvalId, actor, vote, reason) {
      const row = {
        id: crypto.randomUUID(),
        approvalId,
        actor,
        vote,
        reason: reason ?? null,
        createdAt: new Date()
      }
      await db.insert(policyApprovalVotes).values(row)
      return {
        id: row.id,
        approvalId,
        actor,
        vote,
        ...(reason ? { reason } : {}),
        createdAt: row.createdAt.toISOString()
      }
    },
    async updateApprovalStatus(id, status, completedAt) {
      const now = new Date()
      await db
        .update(policyApprovals)
        .set({
          status,
          updatedAt: now,
          ...(completedAt ? { completedAt: new Date(completedAt) } : {})
        })
        .where(eq(policyApprovals.id, id))
      return this.getApproval(id)
    }
  }
}
