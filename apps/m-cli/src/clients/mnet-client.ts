import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * M-Net profile 客户端继续直接命中 m-net 服务，不经过 Core 转发。
 */
export function createMnetClient(
  runtime: CliRuntime
): Pick<
  CliClient,
  | 'listNetworkProfiles'
  | 'getNetworkProfile'
  | 'enableNetworkProfile'
  | 'disableNetworkProfile'
  | 'getMigrationStatus'
  | 'planMigration'
  | 'applyMigration'
  | 'resumeMigration'
  | 'rollbackMigration'
  | 'getDataplaneHealth'
  | 'getRelayAssignment'
  | 'getNetworkMap'
  | 'breakGlass'
> {
  const { mnetRoutes } = runtime

  return {
    listNetworkProfiles: async () => {
      const result = await mnetRoutes.getJson('/api/v0/network-profiles')
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getNetworkProfile: async profileVersion => {
      const result = await mnetRoutes.getJson(`/api/v0/network-profiles/${profileVersion}`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    enableNetworkProfile: async (networkId, profileVersion, reason) => {
      const result = await mnetRoutes.postJson(`/api/v0/networks/${networkId}/profile`, {
        body: { profileVersion, reason }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    disableNetworkProfile: async (networkId, reason) => {
      const result = await mnetRoutes.postJson(`/api/v0/networks/${networkId}/profile`, {
        body: { profileVersion: 'm-net-default@0.1.0', reason }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },

    // ── 迁移命令 ──────────────────────────────────────────────────────────
    getMigrationStatus: async (operationId?: string) => {
      if (operationId) {
        const result = await mnetRoutes.getJson(`/api/v0/networks/profile-switches/${operationId}`)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
      const result = await mnetRoutes.getJson('/api/v0/networks/profile-defaults')
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    planMigration: async (targetVersion, batchSize, reason) => {
      const result = await mnetRoutes.postJson('/api/v0/networks/profile-switches/plan', {
        body: {
          targetProfileVersion: targetVersion,
          ...(batchSize !== undefined ? { batchSize } : {}),
          reason,
          idempotencyKey: crypto.randomUUID()
        }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    applyMigration: async operationId => {
      const result = await mnetRoutes.postJson(
        `/api/v0/networks/profile-switches/${operationId}/apply`
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    resumeMigration: async operationId => {
      const result = await mnetRoutes.postJson(
        `/api/v0/networks/profile-switches/${operationId}/resume`
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    rollbackMigration: async (operationId, reason) => {
      const result = await mnetRoutes.postJson(
        `/api/v0/networks/profile-switches/${operationId}/rollback`,
        { body: { reason } }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },

    // ── 数据面命令 ─────────────────────────────────────────────────────────
    getDataplaneHealth: async networkId => {
      const result = await mnetRoutes.getJson(`/api/v0/networks/${networkId}/dataplane/status`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getRelayAssignment: async networkId => {
      const result = await mnetRoutes.getJson(`/api/v0/networks/${networkId}/dataplane/relay`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getNetworkMap: async networkId => {
      const result = await mnetRoutes.getJson(`/api/v0/networks/${networkId}/dataplane/network-map`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },

    // ── Break-Glass ────────────────────────────────────────────────────────
    breakGlass: async (networkId, reason) => {
      const result = await mnetRoutes.postJson(
        `/api/v0/networks/${networkId}/profile/disable-break-glass`,
        { body: { emergencyReason: reason } }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}
