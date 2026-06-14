import { err, ok } from '../../../../packages/common/src/result.ts'
import type {
  AuditLog,
  FullLog,
  PolicyDecision,
  TimelineLog
} from '../../../../packages/contracts/src/index.ts'
import { type RpcClient, subjects } from '../../../../packages/nats-rpc/src/index.ts'
import type { CoreDeps } from '../types.ts'

type ServiceResponse<T> = {
  ok: true
  decision?: PolicyDecision
  entry?: T
  entries?: T[]
  eventId?: string
}

/**
 * @deprecated 旧版策略 RPC 端口，仅保留兼容路径使用；新代码使用 createHttpPolicyPort。
 */
export function createRpcPolicyPort(rpc: RpcClient) {
  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      try {
        const response = await rpc.request<typeof input, { ok: true; decision: PolicyDecision }>(
          subjects.policyAuthorize,
          input
        )
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    },
    async getDecision(id: string) {
      try {
        const response = await rpc.request<
          { id: string },
          { ok: true; decision: PolicyDecision | null }
        >(subjects.policyDecisionGet, { id })
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    }
  }
}

/**
 * @deprecated 旧版日志 RPC 端口，仅保留兼容路径使用；新代码使用 createHttpLogPort。
 */
export function createRpcLogPort(rpc: RpcClient) {
  return {
    async writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<TimelineLog>>(
          subjects.timelineWrite,
          input
        )
        return response.entry
          ? ok(response.entry)
          : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeFull(input: Omit<FullLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<FullLog>>(
          subjects.fullWrite,
          input
        )
        return response.entry
          ? ok(response.entry)
          : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<AuditLog>>(
          subjects.auditWrite,
          input
        )
        return response.entry
          ? ok(response.entry)
          : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    },
    async listTimeline(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<TimelineLog>>(
          subjects.timelineList,
          limit === undefined ? {} : { limit }
        )
        return response.entries
          ? ok(response.entries)
          : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listFull(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<FullLog>>(
          subjects.fullList,
          limit === undefined ? {} : { limit }
        )
        return response.entries
          ? ok(response.entries)
          : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listAudit(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<AuditLog>>(
          subjects.auditList,
          limit === undefined ? {} : { limit }
        )
        return response.entries
          ? ok(response.entries)
          : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    }
  }
}

/**
 * @deprecated 旧版事件发布 RPC 端口，仅保留兼容路径使用；新代码使用 createHttpEventPort。
 */
export function createRpcEventPort(rpc: RpcClient) {
  return {
    async publish(subject: string, event: Parameters<CoreDeps['events']['publish']>[1]) {
      try {
        const response = await rpc.request<
          { subject: string; event: typeof event },
          { ok: boolean; eventId?: string }
        >(subjects.eventPublish, { subject, event })
        return response.ok && response.eventId
          ? ok({ eventId: response.eventId })
          : err({ code: 'eventbus.rejected', message: 'event rejected by M-EventBus' })
      } catch {
        return err({ code: 'eventbus.unavailable', message: 'M-EventBus unavailable' })
      }
    }
  }
}
