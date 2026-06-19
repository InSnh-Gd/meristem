import { createDb } from '../../../packages/db/src/client.ts'
import { createInternalFetcher, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry } from '../../../packages/telemetry/src/index.ts'
import {
  createApprovalClient,
  createPolicyAuthorizeClient,
  type ApprovalClient,
  type PolicyAuthorize
} from './external-client-factories.ts'
import {
  createEventPublisher,
  createLogWriters,
  createProfileEventsClient,
  createProfileLogClient,
  type ProfileEvents,
  type ProfileLog
} from './event-log-factories.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'
import type { LogApp } from '../../m-log/src/public-types.ts'
import { edenTreaty } from '@elysiajs/eden'
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

export type { ApprovalClient, PolicyAuthorize } from './external-client-factories.ts'
export type { ProfileEvents, ProfileLog } from './event-log-factories.ts'

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

/**
 * M-Net 对 PostgreSQL、M-EventBus、M-Log 和 M-Policy 的客户端接线集中在这里，
 * 让入口文件只负责组装，不直接持有跨服务细节。
 */
export function createMNetInfrastructure(): MNetInfrastructure {
  const { db, client } = createDb()
  initTelemetry('m-net')
  const requireDatabase = typeof process.env.DATABASE_URL === 'string'

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

  const { writeTimeline, writeFull, writeAudit } = createLogWriters(logService)
  const publishEvent = createEventPublisher(eventBus)
  const approvalClient = createApprovalClient(fetcher)
  const profileEvents = createProfileEventsClient(eventBus)
  const profileLog = createProfileLogClient(logService)
  const policyAuthorize = createPolicyAuthorizeClient(fetcher)

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
      console.warn(`m-net: m-net store health check degraded - ${error instanceof Error ? error.message : String(error)}`)
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
