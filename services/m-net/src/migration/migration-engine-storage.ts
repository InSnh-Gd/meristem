import type { MigrationEngineDeps } from './migration-engine-types.ts'
import { toStoredProfileMigrationRecord } from './migration-storage-utils.ts'

/** 读取网络操作已经持久化的迁移记录，以保障重复请求幂等。 */
export async function getStoredMigration(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  networkId: string,
  operationId: string
) {
  return deps.dataPlane.profileMigrations.get(networkId, operationId)
}

/** 将迁移进度及审计元数据转换后写入权威数据面存储。 */
export async function storeMigration(
  deps: Pick<MigrationEngineDeps, 'dataPlane'>,
  input: {
    networkId: string
    fromVersion: string
    toVersion: string
    operationId: string
    status: string
    timestamp: string
    auditMetadata: Record<string, unknown>
  }
) {
  const current = await getStoredMigration(deps, input.networkId, input.operationId)
  const record = toStoredProfileMigrationRecord(input, current?.startedAt)
  await deps.dataPlane.profileMigrations.upsert(record)
}
