import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { MNetAppDeps } from './deps.ts'
import type { GlobalDefaultsStore } from './global-defaults-store.ts'
import { createMigrationEngine, type MigrationEngine } from './migration-engine.ts'
import type { ProfileStore } from './profile-store.ts'

type MigrationEngineLog = {
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(
    level: string,
    message: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
  writeAudit(
    actor: string,
    action: string,
    resource: string,
    result: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
}

export type WiredMigrationEngineInput = {
  globalDefaultsStore: GlobalDefaultsStore
  profileStore: ProfileStore
  dataPlaneStores: DataPlaneStores
  log: MigrationEngineLog
  listMembers?: MNetAppDeps['listMembers']
}

/**
 * 统一装配迁移引擎的跨存储依赖，避免生产入口与测试入口各自复制 audit/full/timeline 写法。
 */
export function createWiredMigrationEngine(input: WiredMigrationEngineInput): MigrationEngine {
  return createMigrationEngine({
    globalDefaultsStore: input.globalDefaultsStore,
    profileStore: input.profileStore,
    dataPlane: input.dataPlaneStores,
    ...(input.listMembers ? { listMembers: input.listMembers } : {}),
    async writeAudit(audit) {
      await input.log.writeAudit(
        audit.actor,
        audit.action,
        audit.resource,
        audit.result,
        audit.correlationId,
        audit.metadata
      )
      return audit.correlationId
    },
    async writeFull(entry) {
      await input.log.writeFull(entry.level, entry.message, entry.correlationId, entry.metadata)
    },
    async writeTimeline(entry) {
      await input.log.writeTimeline(entry.summary, entry.subject, entry.correlationId)
    }
  })
}
