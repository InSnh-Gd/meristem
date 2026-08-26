import type { MNetworkMember } from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type {
  GlobalDefaultsStore,
  NetworkProfileMigrationResult,
  SwitchBatch,
  SwitchOperationStatus
} from './global-defaults-store.ts'
import type { ProfileStore } from './profile-store.ts'

export type { NetworkProfileMigrationResult, SwitchBatch, SwitchOperationStatus }

/** M-Net profile 迁移在存储、数据面和日志边界所需的依赖。 */
export type MigrationEngineDeps = {
  globalDefaultsStore: GlobalDefaultsStore
  profileStore: ProfileStore
  dataPlane: DataPlaneStores
  listMembers?: (input: {
    networkId: string
  }) => Promise<
    { ok: true; value: MNetworkMember[] } | { ok: false; error: { code: string; message: string } }
  >
  writeAudit: (input: {
    actor: string
    action: string
    resource: string
    result: string
    correlationId: string
    metadata?: unknown
  }) => Promise<string | undefined>
  writeFull: (input: {
    level: string
    message: string
    correlationId: string
    metadata?: unknown
  }) => Promise<void>
  writeTimeline?: (input: {
    summary: string
    subject: string
    correlationId: string
  }) => Promise<void>
}

/** M-Net CN 数据面 profile 的迁移目标版本。 */
export const TARGET_CN_PROFILE_VERSION = 'm-net-cn@0.3.0'

/** profile 迁移规划向调用方返回的候选网络与切换批次。 */
export type PlanMigrationResult = {
  operationId: string
  candidateCount: number
  candidates: string[]
  batches: SwitchBatch[]
}
