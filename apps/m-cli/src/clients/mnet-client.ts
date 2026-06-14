import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * M-Net profile 客户端继续直接命中 m-net 服务，不经过 Core 转发。
 */
export function createMnetClient(
  runtime: CliRuntime
): Pick<
  CliClient,
  'listNetworkProfiles' | 'getNetworkProfile' | 'enableNetworkProfile' | 'disableNetworkProfile'
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
    }
  }
}
