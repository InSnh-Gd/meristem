import { eq } from 'drizzle-orm'
import type { MTask, MTaskStatus } from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { policyDecisions, taskDefinitions, taskRequests, taskResults, taskTransitions, taskCancellations } from '../../../packages/db/src/schema.ts'
import type { MTaskCreateInput, MTaskDeps } from './app.ts'

const noopDefinitionId = 'task-definition-noop-v0'

function optionalDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null
}

function toTask(row: typeof taskRequests.$inferSelect): MTask {
  return {
    id: row.id,
    nodeId: row.nodeId,
    leafNodeId: row.nodeId,
    type: row.type as MTask['type'],
    status: row.status as MTaskStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.timeoutAt ? { timeoutAt: row.timeoutAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.canceledAt ? { canceledAt: row.canceledAt.toISOString() } : {})
  }
}

async function ensureNoopDefinition(db: MeristemDb): Promise<void> {
  const now = new Date()
  await db.insert(taskDefinitions).values({
    id: noopDefinitionId,
    type: 'noop',
    version: 'v0',
    description: 'Phase 11 noop task',
    dangerLevel: 'medium',
    defaultTimeoutSeconds: 30,
    createdAt: now,
    updatedAt: now
  }).onConflictDoUpdate({
    target: taskDefinitions.id,
    set: {
      description: 'Phase 11 noop task',
      dangerLevel: 'medium',
      defaultTimeoutSeconds: 30,
      updatedAt: now
    }
  })
}

async function persistedPolicyDecisionId(db: MeristemDb, decisionId: string): Promise<string | null> {
  const [decision] = await db.select({ id: policyDecisions.id }).from(policyDecisions).where(eq(policyDecisions.id, decisionId)).limit(1)
  return decision?.id ?? null
}

/**
 * M-Task 的 PostgreSQL adapter 写入 Phase 11 canonical task 表组。
 * Core 旧 tasks 表只保留历史兼容，不再作为任务生命周期事实来源。
 */
export function createDbMTaskStorage(db: MeristemDb): MTaskDeps['storage'] {
  return {
    async create(input: MTaskCreateInput) {
      await ensureNoopDefinition(db)
      const now = new Date()
      const policyDecisionId = await persistedPolicyDecisionId(db, input.policyDecisionId)
      const row = {
        id: crypto.randomUUID(),
        definitionId: noopDefinitionId,
        nodeId: input.nodeId,
        type: input.type,
        status: 'accepted',
        requestedBy: input.actor,
        policyDecisionId,
        correlationId: input.correlationId,
        risk: input.risk,
        timeoutAt: optionalDate(input.timeoutAt),
        createdAt: now,
        updatedAt: now
      }
      await db.insert(taskRequests).values(row)
      await db.insert(taskTransitions).values({
        id: crypto.randomUUID(),
        taskId: row.id,
        fromStatus: null,
        toStatus: 'accepted',
        reason: 'submit',
        correlationId: input.correlationId,
        createdAt: now
      })
      return toTask({ ...row, completedAt: null, canceledAt: null })
    },
    async list() {
      const rows = await db.select().from(taskRequests)
      return rows.map(toTask)
    },
    async get(id: string) {
      const [row] = await db.select().from(taskRequests).where(eq(taskRequests.id, id)).limit(1)
      return row ? toTask(row) : null
    },
    async transition(id: string, status: MTaskStatus, patch = {}) {
      const [existing] = await db.select().from(taskRequests).where(eq(taskRequests.id, id)).limit(1)
      if (!existing) return null

      const now = new Date()
      const completedAt = optionalDate(patch.completedAt)
      const canceledAt = optionalDate(patch.canceledAt)
      await db.update(taskRequests).set({
        status,
        updatedAt: now,
        ...(completedAt ? { completedAt } : {}),
        ...(canceledAt ? { canceledAt } : {})
      }).where(eq(taskRequests.id, id))
      await db.insert(taskTransitions).values({
        id: crypto.randomUUID(),
        taskId: id,
        fromStatus: existing.status,
        toStatus: status,
        reason: 'lifecycle-transition',
        correlationId: existing.correlationId,
        createdAt: now
      })
      if (status === 'completed' && completedAt) {
        await db.insert(taskResults).values({ taskId: id, status, payload: null, error: null, completedAt }).onConflictDoNothing()
      }
      if (status === 'canceled') {
        await db.insert(taskCancellations).values({
          id: crypto.randomUUID(),
          taskId: id,
          requestedBy: existing.requestedBy,
          status: 'completed',
          correlationId: existing.correlationId,
          requestedAt: now,
          completedAt: canceledAt ?? now
        })
      }

      const [updated] = await db.select().from(taskRequests).where(eq(taskRequests.id, id)).limit(1)
      return updated ? toTask(updated) : null
    }
  }
}
