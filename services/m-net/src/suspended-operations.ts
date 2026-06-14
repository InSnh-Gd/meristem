import type {
  NetworkSuspendedOperation,
  NetworkSuspendedOperationStatus
} from '../../../packages/contracts/src/types/mnet-profile.ts'

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
      const op: NetworkSuspendedOperation = {
        id: crypto.randomUUID(),
        policyDecisionId: input.policyDecisionId,
        action: input.action as NetworkSuspendedOperation['action'],
        networkId: input.networkId,
        fromProfileVersion:
          input.fromProfileVersion as NetworkSuspendedOperation['fromProfileVersion'],
        toProfileVersion: input.toProfileVersion as NetworkSuspendedOperation['toProfileVersion'],
        requestedBy: input.requestedBy as NetworkSuspendedOperation['requestedBy'],
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
