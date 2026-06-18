import { eq } from 'drizzle-orm'
import type {
  NetworkSuspendedOperation,
  NetworkSuspendedOperationStatus
} from '../../../packages/contracts/src/types/mnet-profile.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { mnetSuspendedOperations } from '../../../packages/db/src/schema.ts'
import {
  asActorId,
  asProfileVersion,
  asSuspendedAction,
  buildSuspendedOperation
} from './store-codecs.ts'

/**
 * M-Net 挂起操作存储端口，仅定义接口，不依赖具体数据库实现。
 * 遵循 M-Task suspended-operations 模式，但使用 M-Net 专属类型。
 */
export type SuspendedOperationStore = {
  /** 创建一条挂起操作 */
  create(input: {
    policyDecisionId: string
    action: string
    networkId: string
    fromProfileVersion: string
    toProfileVersion: string
    requestedBy: string
    reason?: string
    correlationId: string
    idempotencyKey: string
    expiresAt: string
  }): Promise<NetworkSuspendedOperation>

  /** 根据 id 获取挂起操作 */
  get(id: string): Promise<NetworkSuspendedOperation | null>

  /** 根据 policyDecisionId 获取挂起操作 */
  getByPolicyDecisionId(policyDecisionId: string): Promise<NetworkSuspendedOperation | null>

  /** 变更挂起操作状态 */
  transition(
    id: string,
    status: NetworkSuspendedOperationStatus,
    terminalReason?: string
  ): Promise<NetworkSuspendedOperation | null>
}

/**
 * 创建内存挂起操作存储适配器，用于单元测试和契约测试。
 */
export function createInMemorySuspendedOperationStore(): SuspendedOperationStore {
  const ops: NetworkSuspendedOperation[] = []

  return {
    async create(input) {
      const action = asSuspendedAction(input.action)
      const requestedBy = asActorId(input.requestedBy)
      const fromProfileVersion = asProfileVersion(input.fromProfileVersion)
      const toProfileVersion = asProfileVersion(input.toProfileVersion)
      if (!action || !requestedBy || !fromProfileVersion || !toProfileVersion) {
        throw new Error('invalid suspended operation input')
      }
      const op: NetworkSuspendedOperation = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        action,
        networkId: input.networkId,
        fromProfileVersion,
        toProfileVersion,
        requestedBy,
        reason: input.reason ?? '',
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

    async transition(id, status, terminalReason) {
      const op = ops.find(candidate => candidate.id === id)
      if (!op) return null
      op.status = status
      if (status === 'resumed') {
        op.resumedAt = new Date().toISOString()
      }
      if (terminalReason) {
        op.terminalReason = terminalReason
      }
      return op
    }
  }
}

/**
 * 创建 PostgreSQL 挂起操作存储，供审批恢复流程读取权威状态。
 */
export function createPgSuspendedOperationStore(db: MeristemDb): SuspendedOperationStore {
  return {
    async create(input) {
      const action = asSuspendedAction(input.action)
      const requestedBy = asActorId(input.requestedBy)
      const fromProfileVersion = asProfileVersion(input.fromProfileVersion)
      const toProfileVersion = asProfileVersion(input.toProfileVersion)
      if (!action || !requestedBy || !fromProfileVersion || !toProfileVersion) {
        throw new Error('invalid suspended operation input')
      }
      const id = crypto.randomUUID()
      const createdAt = new Date()
      await db.insert(mnetSuspendedOperations).values({
        id,
        policyDecisionId: input.policyDecisionId,
        action,
        networkId: input.networkId,
        fromProfileVersion,
        toProfileVersion,
        requestedBy,
        reason: input.reason ?? null,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        status: 'suspended',
        expiresAt: new Date(input.expiresAt),
        createdAt,
        resumedAt: null,
        terminalReason: null
      })
      const created = await this.get(id)
      if (!created) throw new Error('failed to persist suspended operation')
      return created
    },

    async get(id) {
      const [row] = await db
        .select()
        .from(mnetSuspendedOperations)
        .where(eq(mnetSuspendedOperations.id, id))
        .limit(1)
      return row
        ? buildSuspendedOperation({
            id: row.id,
            policyDecisionId: row.policyDecisionId,
            action: row.action,
            networkId: row.networkId,
            fromProfileVersion: row.fromProfileVersion,
            toProfileVersion: row.toProfileVersion,
            requestedBy: row.requestedBy,
            reason: row.reason,
            correlationId: row.correlationId,
            idempotencyKey: row.idempotencyKey,
            status: row.status,
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
            resumedAt: row.resumedAt,
            terminalReason: row.terminalReason
          })
        : null
    },

    async getByPolicyDecisionId(policyDecisionId) {
      const [row] = await db
        .select()
        .from(mnetSuspendedOperations)
        .where(eq(mnetSuspendedOperations.policyDecisionId, policyDecisionId))
        .limit(1)
      return row
        ? buildSuspendedOperation({
            id: row.id,
            policyDecisionId: row.policyDecisionId,
            action: row.action,
            networkId: row.networkId,
            fromProfileVersion: row.fromProfileVersion,
            toProfileVersion: row.toProfileVersion,
            requestedBy: row.requestedBy,
            reason: row.reason,
            correlationId: row.correlationId,
            idempotencyKey: row.idempotencyKey,
            status: row.status,
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
            resumedAt: row.resumedAt,
            terminalReason: row.terminalReason
          })
        : null
    },

    async transition(id, status, terminalReason) {
      const updates = {
        status,
        resumedAt: status === 'resumed' ? new Date() : null,
        terminalReason: terminalReason ?? null
      }
      await db
        .update(mnetSuspendedOperations)
        .set(updates)
        .where(eq(mnetSuspendedOperations.id, id))
      return this.get(id)
    }
  }
}
