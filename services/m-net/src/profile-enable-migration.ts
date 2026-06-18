import type {
  CHINA_DATA_PLANE_PROFILE_VERSION,
  KnownNetworkState,
  ProfileWorkflowFailure,
  ProfileWriteDeps
} from './profile-workflow-types.ts'
import {
  CHINA_PROFILE_VERSION,
  profileWorkflowFailure
} from './profile-workflow-types.ts'

/**
 * enable 中国数据面 Profile 前的迁移处理：
 * 如果当前网络仍在使用旧版 China Profile（m-net-cn@0.1.0），
 * 通过迁移引擎升级到数据面 Profile（m-net-cn@0.2.0）。
 */
export async function migrateLegacyCnProfileBeforeEnable(
  deps: ProfileWriteDeps,
  input: {
    actor: string
    networkId: string
    state: KnownNetworkState
    profileVersion: typeof CHINA_PROFILE_VERSION | typeof CHINA_DATA_PLANE_PROFILE_VERSION
    reason: string
  }
): Promise<{ ok: true } | ProfileWorkflowFailure> {
  // 只有旧版 China 控制面 profile 升级到数据面 profile 时才需要迁移引擎；
  // 从 default/disabled 直接启用数据面 profile 属于首次编排，不应被迁移依赖拦截。
  if (input.state.profileVersion !== CHINA_PROFILE_VERSION) {
    return { ok: true }
  }
  // 需要迁移引擎
  if (!deps.migrationEngine) {
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'migration engine not available for legacy profile upgrade'
    )
  }

  const result = await deps.migrationEngine.migrateNetwork({
    networkId: input.networkId,
    actor: input.actor,
    reason: input.reason,
    targetStatus: 'enabled'
  })

  if (
    !result.ok ||
    (result.value.result.status !== 'applied' && result.value.result.status !== 'pending')
  ) {
    return profileWorkflowFailure(
      503,
      'migration.failed',
      'legacy to data-plane profile migration failed'
    )
  }

  return { ok: true }
}
