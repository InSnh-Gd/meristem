import { eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { mnetProfileDisablePolicies } from '../../../packages/db/src/schema.ts'
import { decodeBoolean, encodeBoolean } from './store-codecs.ts'
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

const policyRowId = 'singleton'

async function ensurePolicyRow(db: MeristemDb): Promise<void> {
  await db
    .insert(mnetProfileDisablePolicies)
    .values({
      id: policyRowId,
      requireApproval: encodeBoolean(DEFAULT_DISABLE_POLICY.requireApproval),
      emergencyBreakGlassEnabled: encodeBoolean(DEFAULT_DISABLE_POLICY.emergencyBreakGlassEnabled),
      reason: DEFAULT_DISABLE_POLICY.reason,
      idempotencyKey: DEFAULT_DISABLE_POLICY.idempotencyKey,
      updatedAt: new Date(DEFAULT_DISABLE_POLICY.updatedAt)
    })
    .onConflictDoNothing()
}

/**
 * 创建 PostgreSQL 禁用审批策略存储，确保 break-glass 策略跨服务重启保持一致。
 */
export function createPgProfileDisablePolicyStore(db: MeristemDb): ProfileDisablePolicyStore {
  return {
    async getPolicy() {
      await ensurePolicyRow(db)
      const [row] = await db
        .select()
        .from(mnetProfileDisablePolicies)
        .where(eq(mnetProfileDisablePolicies.id, policyRowId))
        .limit(1)
      return row
        ? {
            requireApproval: decodeBoolean(row.requireApproval),
            emergencyBreakGlassEnabled: decodeBoolean(row.emergencyBreakGlassEnabled),
            reason: row.reason,
            idempotencyKey: row.idempotencyKey,
            updatedAt: row.updatedAt.toISOString()
          }
        : { ...DEFAULT_DISABLE_POLICY }
    },

    async setPolicy(input) {
      const updatedAt = new Date()
      await ensurePolicyRow(db)
      await db
        .update(mnetProfileDisablePolicies)
        .set({
          requireApproval: encodeBoolean(input.requireApproval),
          emergencyBreakGlassEnabled: encodeBoolean(input.emergencyBreakGlassEnabled),
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          updatedAt
        })
        .where(eq(mnetProfileDisablePolicies.id, policyRowId))
      return {
        requireApproval: input.requireApproval,
        emergencyBreakGlassEnabled: input.emergencyBreakGlassEnabled,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        updatedAt: updatedAt.toISOString()
      }
    }
  }
}
