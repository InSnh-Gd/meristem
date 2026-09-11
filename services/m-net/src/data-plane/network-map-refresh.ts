import type { MNetProfileVersionFromSchema } from '../../../../packages/contracts/src/schemas/mnet-profile.ts'
import type { ProfileStore } from '../profile/profile-store.ts'
import type { ListMembers, ProfileEvents } from '../profile/profile-workflow-types.ts'
import { isProfileWorkflowFailure } from '../profile/profile-workflow-types.ts'
import { asProfileVersion } from '../store-codecs.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { MaterializedMembers } from './mnet-dataplane-support.ts'

/**
 * 成员变更后刷新签名网络地图所需的最小能力集。
 *
 * 与 enable 路径的区别：enable 的 writeOptionalArtifacts 会连带发布 relay.assigned /
 * profile.enabled 事件，那些语义只适用于启用流程；成员增删只应重新物化 map 并发布
 * mnet.network_map.published.v0。因此这里不直接复用 writeOptionalArtifacts。
 *
 * 以能力集（而非完整 DataPlaneDeps）注入，便于单测且不让调用方承担无关依赖。
 */
export type NetworkMapRefreshDeps = {
  profileStore: Pick<ProfileStore, 'getNetworkState'>
  listMembers: ListMembers
  /** 重新物化成员地址/密钥并持久化 map；失败（如成员缺失）返回 null，由本模块降级为 no-op。 */
  materialize(
    profileVersion: MNetProfileVersionFromSchema,
    correlationId: string
  ): Promise<MaterializedMembers | null>
  events?: Pick<ProfileEvents, 'publish'>
}

/**
 * 刷新网络 map。
 *
 * 空成员按 no-op 处理：「移除最后一个成员」是合法操作，而 materializeMembers 对空成员
 * 返回 409 network.members_missing；若把该错误上抛，合法的最后成员移除会被翻成失败。
 * profile 版本无法收窄（未知版本）时同样跳过，交由既有校验路径处理。
 *
 * @returns 是否实际物化并发布了 map。
 */
export async function refreshNetworkMap(
  deps: NetworkMapRefreshDeps,
  networkId: string,
  correlationId: string
): Promise<boolean> {
  const state = await deps.profileStore.getNetworkState(networkId)
  const profileVersion = state ? asProfileVersion(state.profileVersion) : null
  if (!profileVersion) return false

  const members = await deps.listMembers({ networkId })
  if (!members.ok) return false
  if (members.value.length === 0) return false

  const materialized = await deps.materialize(profileVersion, correlationId)
  // 物化失败（如成员在两次读之间被移除）按 no-op 处理，不把成员变更翻成错误。
  if (!materialized) return false
  await deps.events?.publish(
    'mnet.network_map.published.v0',
    'mnet.network_map.published',
    {
      networkId,
      mapVersion: materialized.mapVersion,
      profileVersion,
      relayAssignment: materialized.relayAssignment,
      correlationId
    },
    correlationId
  )
  return true
}

/**
 * 从完整数据面依赖派生 map refresher，供启动装配注入 network service。
 * 抽出以便 startup 保持薄装配，并让能力集与 materialize 的绑定集中在一处。
 */
export function createNetworkMapRefresher(
  deps: import('./mnet-dataplane-support.ts').DataPlaneDeps,
  materialize: (
    deps: import('./mnet-dataplane-support.ts').DataPlaneDeps,
    networkId: string,
    profileVersion: MNetProfileVersionFromSchema,
    correlationId: string
  ) => Promise<
    MaterializedMembers | import('../profile/profile-workflow-types.ts').ProfileWorkflowFailure
  >
): (networkId: string, correlationId: string) => Promise<void> {
  return async (networkId, correlationId) => {
    await refreshNetworkMap(
      {
        profileStore: deps.profileStore,
        listMembers: deps.listMembers,
        materialize: async (profileVersion, cid) => {
          const result = await materialize(deps, networkId, profileVersion, cid)
          return isProfileWorkflowFailure(result) ? null : result
        },
        ...(deps.events ? { events: deps.events } : {})
      },
      networkId,
      correlationId
    )
  }
}

export type { DataPlaneStores }
