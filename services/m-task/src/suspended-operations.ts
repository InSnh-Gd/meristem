import { eq } from 'drizzle-orm'
import type {
  ActorId,
  ApprovalOriginAction,
  SuspendedOperationStatus,
  TaskSuspendedOperation
} from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { policyDecisions, taskSuspendedOperations } from '../../../packages/db/src/schema.ts'

// M-Task 拥有的挂起操作存储端口；M-Policy 不直接读写此表。
export type SuspendedOperationStore = {
  create(input: {
    policyDecisionId: string
    action: ApprovalOriginAction
    requestedBy: ActorId
    resource: string
    sanitizedPayload: unknown
    correlationId: string
    idempotencyKey: string
    expiresAt: string
  }): Promise<TaskSuspendedOperation>
  get(id: string): Promise<TaskSuspendedOperation | null>
  getByPolicyDecisionId(policyDecisionId: string): Promise<TaskSuspendedOperation | null>
  listByStatus(status: SuspendedOperationStatus): Promise<TaskSuspendedOperation[]>
  transition(
    id: string,
    status: SuspendedOperationStatus,
    terminalReason?: string
  ): Promise<TaskSuspendedOperation | null>
}

function toSuspendedOp(row: typeof taskSuspendedOperations.$inferSelect): TaskSuspendedOperation {
  return {
    id: row.id,
    policyDecisionId: row.policyDecisionId,
    action: row.action as ApprovalOriginAction,
    requestedBy: row.requestedBy as ActorId,
    resource: row.resource,
    sanitizedPayload: row.sanitizedPayload,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as SuspendedOperationStatus,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    ...(row.resumedAt ? { resumedAt: row.resumedAt.toISOString() } : {}),
    ...(row.terminalReason ? { terminalReason: row.terminalReason } : {})
  }
}

/**
 * PostgreSQL adapter for task_suspended_operations；M-Task 唯一权威写路径。
 */
export function createDbSuspendedOperationStore(db: MeristemDb): SuspendedOperationStore {
  return {
    async create(input) {
      const [decision] = await db
        .select({ id: policyDecisions.id })
        .from(policyDecisions)
        .where(eq(policyDecisions.id, input.policyDecisionId))
        .limit(1)
      const policyDecisionId = decision?.id ?? input.policyDecisionId
      const now = new Date()
      const row = {
        id: crypto.randomUUID(),
        policyDecisionId,
        action: input.action,
        requestedBy: input.requestedBy,
        resource: input.resource,
        sanitizedPayload: input.sanitizedPayload,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        status: 'suspended',
        expiresAt: new Date(input.expiresAt),
        createdAt: now
      }
      await db.insert(taskSuspendedOperations).values(row)
      return toSuspendedOp({ ...row, resumedAt: null, terminalReason: null })
    },
    async get(id) {
      const [row] = await db
        .select()
        .from(taskSuspendedOperations)
        .where(eq(taskSuspendedOperations.id, id))
        .limit(1)
      return row ? toSuspendedOp(row) : null
    },
    async getByPolicyDecisionId(policyDecisionId) {
      const [row] = await db
        .select()
        .from(taskSuspendedOperations)
        .where(eq(taskSuspendedOperations.policyDecisionId, policyDecisionId))
        .limit(1)
      return row ? toSuspendedOp(row) : null
    },
    async listByStatus(status) {
      const rows = await db
        .select()
        .from(taskSuspendedOperations)
        .where(eq(taskSuspendedOperations.status, status))
      return rows.map(toSuspendedOp)
    },
    async transition(id, status, terminalReason) {
      const [existing] = await db
        .select()
        .from(taskSuspendedOperations)
        .where(eq(taskSuspendedOperations.id, id))
        .limit(1)
      if (!existing) return null
      const now = new Date()
      await db
        .update(taskSuspendedOperations)
        .set({
          status,
          ...(status === 'resumed' ? { resumedAt: now } : {}),
          ...(terminalReason ? { terminalReason } : {})
        })
        .where(eq(taskSuspendedOperations.id, id))
      const [updated] = await db
        .select()
        .from(taskSuspendedOperations)
        .where(eq(taskSuspendedOperations.id, id))
        .limit(1)
      return updated ? toSuspendedOp(updated) : null
    }
  }
}

/**
 * 内存挂起操作存储，用于单元测试。
 */
export function createInMemorySuspendedOperationStore(): SuspendedOperationStore & {
  __testing: { all(): TaskSuspendedOperation[] }
} {
  const ops: TaskSuspendedOperation[] = []

  return {
    __testing: { all: () => [...ops] },
    async create(input) {
      const op: TaskSuspendedOperation = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        action: input.action,
        requestedBy: input.requestedBy,
        resource: input.resource,
        sanitizedPayload: input.sanitizedPayload,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        status: 'suspended',
        expiresAt: input.expiresAt,
        createdAt: new Date().toISOString()
      }
      ops.push(op)
      return op
    },
    async get(id) {
      return ops.find(op => op.id === id) ?? null
    },
    async getByPolicyDecisionId(policyDecisionId) {
      return ops.find(op => op.policyDecisionId === policyDecisionId) ?? null
    },
    async listByStatus(status) {
      return ops.filter(op => op.status === status)
    },
    async transition(id, status, terminalReason) {
      const op = ops.find(candidate => candidate.id === id)
      if (!op) return null
      op.status = status
      if (status === 'resumed') op.resumedAt = new Date().toISOString()
      if (terminalReason) op.terminalReason = terminalReason
      return op
    }
  }
}
