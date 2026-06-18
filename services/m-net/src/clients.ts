import { edenTreaty } from '@elysiajs/eden'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createInternalFetcher, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'
import type { LogApp } from '../../m-log/src/public-types.ts'
import { createInMemoryDataPlaneStores } from './data-plane-store-memory.ts'
import { createPgDataPlaneStores } from './data-plane-store-pg.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import {
  createInMemoryGlobalDefaultsStore,
  type GlobalDefaultsStore
} from './global-defaults-store.ts'
import { createPgGlobalDefaultsStore } from './global-defaults-store-pg.ts'
import type { MigrationEngine } from './migration-engine.ts'
import { createWiredMigrationEngine } from './migration-engine-factory.ts'
import {
  createInMemoryProfileDisablePolicyStore,
  createPgProfileDisablePolicyStore,
  type ProfileDisablePolicyStore
} from './profile-disable-policy.ts'
import {
  createInMemoryProfileStore,
  createPgProfileStore,
  type ProfileStore
} from './profile-store.ts'
import { asActorId } from './store-codecs.ts'
import {
  createInMemorySuspendedOperationStore,
  createPgSuspendedOperationStore,
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
  globalDefaultsStore: GlobalDefaultsStore
  suspendedOps: SuspendedOperationStore
  profileDisablePolicy: ProfileDisablePolicyStore
  migrationEngine: MigrationEngine
  dataPlaneStores: DataPlaneStores
  requireDatabase: boolean
  checkStoreHealth(): Promise<boolean>
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

function readApprovalBody(value: unknown): { code: string; message: string } {
  if (typeof value !== 'object' || value === null) {
    return { code: 'approval.create_failed', message: 'failed to create approval' }
  }
  const error =
    'error' in value && typeof value.error === 'object' && value.error !== null ? value.error : null
  const code =
    error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'approval.create_failed'
  const message =
    error && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'failed to create approval'
  return { code, message }
}

function readApprovalSuccess(value: unknown): { approvalId: string } | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('approval' in value) || typeof value.approval !== 'object' || value.approval === null)
    return null
  if (!('id' in value.approval) || typeof value.approval.id !== 'string') return null
  return { approvalId: value.approval.id }
}

function readPolicyDecision(value: unknown): {
  result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  id: string
  reasons: string[]
} | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('decision' in value) || typeof value.decision !== 'object' || value.decision === null)
    return null
  const decision = value.decision
  if (!('result' in decision) || typeof decision.result !== 'string') return null
  if (!('id' in decision) || typeof decision.id !== 'string') return null
  if (!('reasons' in decision) || !Array.isArray(decision.reasons)) return null
  if (
    !['allow', 'deny', 'require_manual_review', 'require_multi_approval'].includes(decision.result)
  ) {
    return null
  }
  let result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  switch (decision.result) {
    case 'allow':
    case 'deny':
    case 'require_manual_review':
    case 'require_multi_approval':
      result = decision.result
      break
    default:
      return null
  }
  const reasons = decision.reasons.filter((reason): reason is string => typeof reason === 'string')
  return {
    result,
    id: decision.id,
    reasons
  }
}

/**
 * M-Net 对 PostgreSQL、M-EventBus、M-Log 和 M-Policy 的客户端接线集中在这里，
 * 让入口文件只负责组装，不直接持有跨服务细节。
 */
export function createMNetInfrastructure(): MNetInfrastructure {
  const { db, client } = createDb()
  initTelemetry('m-net')
  const requireDatabase = typeof process.env.DATABASE_URL === 'string'

  const warnInfrastructureFallback = (operation: string, error: unknown) => {
    console.warn(
      `m-net: ${operation} degraded - ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const fetcher = createInternalFetcher()
  const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), { fetcher })
  const logService = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher })

  const profileStore = requireDatabase ? createPgProfileStore(db) : createInMemoryProfileStore()
  const globalDefaultsStore = requireDatabase
    ? createPgGlobalDefaultsStore(db, profileStore)
    : createInMemoryGlobalDefaultsStore(profileStore)
  const suspendedOps = requireDatabase
    ? createPgSuspendedOperationStore(db)
    : createInMemorySuspendedOperationStore()
  const profileDisablePolicy = requireDatabase
    ? createPgProfileDisablePolicyStore(db)
    : createInMemoryProfileDisablePolicyStore()
  const dataPlaneStores = requireDatabase
    ? createPgDataPlaneStores(db)
    : createInMemoryDataPlaneStores()

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
          const body = await response.json().catch(error => {
            warnInfrastructureFallback('approval error response parse', error)
            return {}
          })
          const parsed = readApprovalBody(body)
          return {
            ok: false,
            error: parsed
          }
        }
        const parsed = readApprovalSuccess(await response.json())
        if (!parsed) {
          return {
            ok: false,
            error: { code: 'approval.create_failed', message: 'invalid approval response' }
          }
        }
        return { ok: true, value: parsed }
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
        const parsed = readPolicyDecision(await response.json())
        if (!parsed) {
          return {
            result: 'deny' as const,
            id: crypto.randomUUID(),
            reasons: ['invalid policy decision response']
          }
        }
        return parsed
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

  const migrationEngine = createWiredMigrationEngine({
    globalDefaultsStore,
    profileStore,
    dataPlaneStores,
    log: {
      async writeTimeline(summary, subject, correlationId) {
        await profileLog.writeTimeline(summary, subject, correlationId)
      },
      async writeFull(level, message, correlationId, payload) {
        await profileLog.writeFull(level, message, correlationId, payload)
      },
      async writeAudit(actor, action, resource, result, correlationId, payload) {
        const normalizedActor = asActorId(actor)
        if (!normalizedActor) throw new Error('invalid audit actor for migration engine')
        await profileLog.writeAudit(
          normalizedActor,
          action,
          resource,
          result,
          correlationId,
          payload
        )
      }
    }
  })

  async function checkStoreHealth(): Promise<boolean> {
    try {
      await Promise.all([
        profileStore.getDefinitions(),
        globalDefaultsStore.getDefaultProfileVersion(),
        profileDisablePolicy.getPolicy()
      ])
      return true
    } catch (error: unknown) {
      warnInfrastructureFallback('m-net store health check', error)
      return false
    }
  }

  return {
    db,
    client,
    profileStore,
    globalDefaultsStore,
    suspendedOps,
    profileDisablePolicy,
    migrationEngine,
    dataPlaneStores,
    requireDatabase,
    checkStoreHealth,
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
