import { edenTreaty } from '@elysiajs/eden'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createInternalFetcher, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'
import type { LogApp } from '../../m-log/src/public-types.ts'
import { createInMemoryProfileStore, type ProfileStore } from './profile-store.ts'
import {
  createInMemorySuspendedOperationStore,
  type SuspendedOperationStore
} from './suspended-operations.ts'

export type MNetDb = ReturnType<typeof createDb>['db']
export type MNetSqlClient = ReturnType<typeof createDb>['client']

export type ApprovalClient = {
  create(input: {
    policyDecisionId: string
    originService: string
    operationId: string
    requestedBy: string
    requiredAction: string
    quorumRequired: number
    expiresAt: string
  }): Promise<
    | { ok: true; value: { approvalId: string } }
    | { ok: false; error: { code: string; message: string } }
  >
}

export type ProfileEvents = {
  publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
}

export type ProfileLog = {
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(
    level: string,
    message: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
  writeAudit(
    actor: ActorId,
    action: string,
    resource: string,
    result: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
}

export type PolicyAuthorize = {
  authorize(
    actor: string,
    action: string,
    resource: string
  ): Promise<{
    result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
    id: string
    reasons: string[]
  }>
}

export type MNetInfrastructure = {
  db: MNetDb
  client: MNetSqlClient
  profileStore: ProfileStore
  suspendedOps: SuspendedOperationStore
  approvalClient: ApprovalClient
  profileEvents: ProfileEvents
  profileLog: ProfileLog
  policyAuthorize: PolicyAuthorize
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

/**
 * M-Net 对 PostgreSQL、M-EventBus、M-Log 和 M-Policy 的客户端接线集中在这里，
 * 让入口文件只负责组装，不直接持有跨服务细节。
 */
export function createMNetInfrastructure(): MNetInfrastructure {
  const { db, client } = createDb()
  initTelemetry('m-net')

  const warnInfrastructureFallback = (operation: string, error: unknown) => {
    console.warn(
      `m-net: ${operation} degraded - ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const fetcher = createInternalFetcher()
  const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), { fetcher })
  const logService = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher })

  const profileStore = createInMemoryProfileStore()
  const suspendedOps = createInMemorySuspendedOperationStore()

  async function publishEvent(
    subject: string,
    type: string,
    payload: unknown,
    correlationId?: string,
    traceId?: string
  ): Promise<void> {
    const event = createEventEnvelope({
      type,
      source: 'm-net',
      payload,
      ...(correlationId ? { correlationId } : {}),
      ...(traceId ? { traceId } : {})
    })
    const response = await eventBus.internal.v0.publish.post({ subject, event })
    if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
  }

  async function writeTimeline(
    summary: string,
    subject?: string,
    correlationId?: string
  ): Promise<void> {
    const response = await logService.internal.v0.timeline.post({
      summary,
      ...(subject ? { subject } : {}),
      ...(correlationId ? { correlationId } : {})
    })
    if (response.error || !response.data) throw new Error('failed to write timeline entry')
  }

  async function writeFull(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void> {
    const response = await logService.internal.v0.full.post({
      level,
      source: 'm-net',
      message,
      ...(correlationId ? { correlationId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(payload === undefined ? {} : { payload })
    })
    if (response.error || !response.data) throw new Error('failed to write full log entry')
  }

  async function writeAudit(
    resource: string,
    action: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void> {
    const response = await logService.internal.v0.audit.post({
      actor: 'system',
      action,
      resource,
      result: 'deny',
      ...(correlationId ? { correlationId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(payload === undefined ? {} : { payload })
    })
    if (response.error || !response.data) throw new Error('failed to write audit entry')
  }

  const approvalClient: ApprovalClient = {
    /**
     * 审批创建通过 M-Policy internal HTTP 边界完成；降级路径返回结构化错误，不在入口层吞掉失败原因。
     */
    async create(input) {
      try {
        const response = await fetcher(`${serviceUrl('m-policy')}/internal/v0/policy/approvals`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input)
        })
        if (!response.ok) {
          const body = (await response.json().catch(error => {
            warnInfrastructureFallback('approval error response parse', error)
            return {}
          })) as {
            error?: { code?: string; message?: string }
          }
          return {
            ok: false,
            error: {
              code: body.error?.code ?? 'approval.create_failed',
              message: body.error?.message ?? 'failed to create approval'
            }
          }
        }
        const data = (await response.json()) as { approval: { id: string } }
        return { ok: true, value: { approvalId: data.approval.id } }
      } catch (error: unknown) {
        warnInfrastructureFallback('approval create request', error)
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: { code: 'approval.create_failed', message } }
      }
    }
  }

  const profileEvents: ProfileEvents = {
    async publish(subject, type, payload, correlationId) {
      const event = createEventEnvelope({
        type,
        source: 'm-net',
        payload,
        ...(correlationId ? { correlationId } : {})
      })
      const response = await eventBus.internal.v0.publish.post({ subject, event })
      if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
    }
  }

  const profileLog: ProfileLog = {
    async writeTimeline(summary, subject, correlationId) {
      const response = await logService.internal.v0.timeline.post({
        summary,
        ...(subject ? { subject } : {}),
        ...(correlationId ? { correlationId } : {})
      })
      if (response.error || !response.data) throw new Error('failed to write timeline')
    },
    async writeFull(level, message, correlationId, payload) {
      const response = await logService.internal.v0.full.post({
        level: level as 'debug' | 'info' | 'warn' | 'error',
        source: 'm-net',
        message,
        ...(correlationId ? { correlationId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write full log')
    },
    async writeAudit(actor, action, resource, result, correlationId, payload) {
      const response = await logService.internal.v0.audit.post({
        actor,
        action,
        resource,
        result: result as 'success' | 'failure' | 'deny' | 'pending' | 'allow' | 'canceled',
        ...(correlationId ? { correlationId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write audit')
    }
  }

  const policyAuthorize: PolicyAuthorize = {
    /**
     * M-Policy 不可用时必须 fail-closed，保持高风险控制面操作默认拒绝。
     */
    async authorize(actor, action, resource) {
      try {
        const response = await fetcher(`${serviceUrl('m-policy')}/internal/v0/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actor, action, resource })
        })
        if (!response.ok) {
          return {
            result: 'deny' as const,
            id: crypto.randomUUID(),
            reasons: ['policy service unavailable']
          }
        }
        const data = (await response.json()) as {
          decision: { result: string; id: string; reasons: string[] }
        }
        return {
          result: data.decision.result as
            | 'allow'
            | 'deny'
            | 'require_manual_review'
            | 'require_multi_approval',
          id: data.decision.id,
          reasons: data.decision.reasons
        }
      } catch (error: unknown) {
        warnInfrastructureFallback('policy authorize request', error)
        return {
          result: 'deny' as const,
          id: crypto.randomUUID(),
          reasons: ['policy service unreachable']
        }
      }
    }
  }

  return {
    db,
    client,
    profileStore,
    suspendedOps,
    approvalClient,
    profileEvents,
    profileLog,
    policyAuthorize,
    publishEvent,
    writeTimeline,
    writeFull,
    writeAudit
  }
}
