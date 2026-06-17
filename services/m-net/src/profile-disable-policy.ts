import type { SetProfileDisablePolicyRequest } from './types.ts'

/**
 * 配置化的 Profile Disable 审批策略。
 *
 * 默认策略：requireApproval: false（即停立即生效），emergencyBreakGlassEnabled: true。
 * 当 requireApproval 为 true 时，常规 disable 进入挂起操作 + 审批流程（与 enable 一致）。
 * break-glass 始终可用（当 emergencyBreakGlassEnabled 为 true），绕过常规审批，
 * 但仅限 security-admin 角色且必须有 emergencyReason 或服务端检测到审批降级。
 */
export type ProfileDisablePolicy = {
  requireApproval: boolean
  emergencyBreakGlassEnabled: boolean
  reason: string
  idempotencyKey: string
  updatedAt: string
}

export const DEFAULT_DISABLE_POLICY: ProfileDisablePolicy = {
  requireApproval: false,
  emergencyBreakGlassEnabled: true,
  reason: 'default',
  idempotencyKey: '',
  updatedAt: new Date().toISOString()
}

export type ProfileDisablePolicyStore = {
  /** 获取当前策略 */
  getPolicy(): Promise<ProfileDisablePolicy>

  /** 更新策略 */
  setPolicy(input: SetProfileDisablePolicyRequest): Promise<ProfileDisablePolicy>
}

/**
 * 内存策略存储，用于测试和 MVP。
 */
export function createInMemoryProfileDisablePolicyStore(): ProfileDisablePolicyStore {
  let current: ProfileDisablePolicy = { ...DEFAULT_DISABLE_POLICY }

  return {
    async getPolicy() {
      return { ...current }
    },

    async setPolicy(input) {
      current = {
        requireApproval: input.requireApproval,
        emergencyBreakGlassEnabled: input.emergencyBreakGlassEnabled,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        updatedAt: new Date().toISOString()
      }
      return { ...current }
    }
  }
}
