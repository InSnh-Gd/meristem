import type {
  CommandWellEligibility,
  OperationalCommandPreview,
  OperationalCommandPreviewCommandId,
  Permission
} from '../../../packages/contracts/src/index.ts'

export type StateSourceMetadata = {
  sourceType: 'authoritative' | 'event' | 'cache' | 'read-model' | 'log' | 'audit' | 'policy'
  sourceId: string
  correlationId?: string
  traceId?: string
}

export type GenericNoopEligibility =
  | {
      state: 'enabled'
      command: {
        id: 'task.noop.submit'
        label: string
        action: Permission
        resource: string
        risk: 'medium'
        requiredPermissions: readonly Permission[]
        requiresPolicy: boolean
        requiresAudit: boolean
      }
    }
  | Extract<CommandWellEligibility, { state: 'disabled' }>

export const GENERIC_NOOP_COMMAND_ID = 'task.noop.submit'

export type ApprovalPreviewBody = {
  approvalId: string
}

export type NetworkProfilePreviewBody = {
  networkId: string
  profileVersion: string
}

export type NetworkProfileDefaultSetBody = {
  profileVersion: string
  reason?: string
  idempotencyKey?: string
}

export type NetworkProfileGlobalSwitchPlanBody = {
  targetProfileVersion: string
  batchSize?: number
  reason?: string
  idempotencyKey?: string
}

export type NetworkProfileGlobalSwitchApplyBody = {
  operationId: string
}

export type NetworkProfileDisablePolicySetBody = {
  requireApproval: boolean
  emergencyBreakGlassEnabled: boolean
  reason?: string
  idempotencyKey?: string
}

export type NetworkProfileBreakGlassDisableBody = {
  networkId: string
  emergencyReason?: string
}

export type GenericCommandEligibilityBody =
  | {
      leafNodeId: string
    }
  | ApprovalPreviewBody
  | NetworkProfilePreviewBody
  | NetworkProfileDefaultSetBody
  | NetworkProfileGlobalSwitchPlanBody
  | NetworkProfileGlobalSwitchApplyBody
  | NetworkProfileDisablePolicySetBody
  | NetworkProfileBreakGlassDisableBody

export type CommandPreviewDefinition = Pick<
  OperationalCommandPreview,
  | 'commandId'
  | 'label'
  | 'action'
  | 'risk'
  | 'requiredPermissions'
  | 'requiresPolicy'
  | 'requiresAudit'
>

export const COMMAND_PREVIEW_DEFINITIONS: Record<
  OperationalCommandPreviewCommandId,
  CommandPreviewDefinition
> = {
  'policy.approval.approve.preview': {
    commandId: 'policy.approval.approve.preview',
    label: '批准审批请求',
    action: 'display-only',
    risk: 'high',
    requiredPermissions: ['policy:approval-approve'],
    requiresPolicy: true,
    requiresAudit: true
  },
  'policy.approval.reject.preview': {
    commandId: 'policy.approval.reject.preview',
    label: '拒绝审批请求',
    action: 'display-only',
    risk: 'high',
    requiredPermissions: ['policy:approval-reject'],
    requiresPolicy: true,
    requiresAudit: true
  },
  'network.profile.enable.preview': {
    commandId: 'network.profile.enable.preview',
    label: '启用 Network Profile',
    action: 'display-only',
    risk: 'high',
    requiredPermissions: ['network:profile-enable'],
    requiresPolicy: true,
    requiresAudit: true
  },
  'network.profile.disable.preview': {
    commandId: 'network.profile.disable.preview',
    label: '停用 Network Profile',
    action: 'display-only',
    risk: 'high',
    requiredPermissions: ['network:profile-disable'],
    requiresPolicy: true,
    requiresAudit: true
  }
}

export const DISPLAY_ONLY_COMMAND_IDS = Object.freeze(
  Object.keys(COMMAND_PREVIEW_DEFINITIONS) as OperationalCommandPreviewCommandId[]
)

// ── Execute command IDs ────────────────────────────────────────────────────

/** 审批通过执行命令 ID */
export const APPROVAL_APPROVE_EXECUTE_COMMAND_ID = 'policy.approval.approve.execute'
/** 审批拒绝执行命令 ID */
export const APPROVAL_REJECT_EXECUTE_COMMAND_ID = 'policy.approval.reject.execute'
/** Profile 启用执行命令 ID */
export const PROFILE_ENABLE_EXECUTE_COMMAND_ID = 'network.profile.enable.execute'
/** Profile 停用执行命令 ID */
export const PROFILE_DISABLE_EXECUTE_COMMAND_ID = 'network.profile.disable.execute'
/** 全局默认 Profile 设置执行命令 ID */
export const PROFILE_DEFAULT_SET_EXECUTE_COMMAND_ID = 'network.profile.default.set.execute'
/** 全局 Profile 切换规划执行命令 ID */
export const PROFILE_GLOBAL_SWITCH_PLAN_EXECUTE_COMMAND_ID =
  'network.profile.global-switch.plan.execute'
/** 全局 Profile 切换应用执行命令 ID */
export const PROFILE_GLOBAL_SWITCH_APPLY_EXECUTE_COMMAND_ID =
  'network.profile.global-switch.apply.execute'
/** Profile 禁用策略设置执行命令 ID */
export const PROFILE_DISABLE_POLICY_SET_EXECUTE_COMMAND_ID =
  'network.profile.disable-policy.set.execute'
/** Profile break-glass 禁用执行命令 ID */
export const PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID =
  'network.profile.disable.break-glass.execute'

/** 所有可执行 CommandWell 命令 ID 列表 */
export const EXECUTE_COMMAND_IDS = [
  APPROVAL_APPROVE_EXECUTE_COMMAND_ID,
  APPROVAL_REJECT_EXECUTE_COMMAND_ID,
  PROFILE_ENABLE_EXECUTE_COMMAND_ID,
  PROFILE_DISABLE_EXECUTE_COMMAND_ID,
  PROFILE_DEFAULT_SET_EXECUTE_COMMAND_ID,
  PROFILE_GLOBAL_SWITCH_PLAN_EXECUTE_COMMAND_ID,
  PROFILE_GLOBAL_SWITCH_APPLY_EXECUTE_COMMAND_ID,
  PROFILE_DISABLE_POLICY_SET_EXECUTE_COMMAND_ID,
  PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID
] as const

/** 可执行命令 ID 联合类型 */
export type ExecuteCommandId = (typeof EXECUTE_COMMAND_IDS)[number]

/** execute 命令在 BFF 侧的最小权限预检映射，只用于阻止明显无权限的 mutation 请求。 */
export const EXECUTE_COMMAND_REQUIRED_PERMISSIONS: Record<ExecuteCommandId, Permission> = {
  [APPROVAL_APPROVE_EXECUTE_COMMAND_ID]: 'policy:approval-approve',
  [APPROVAL_REJECT_EXECUTE_COMMAND_ID]: 'policy:approval-reject',
  [PROFILE_ENABLE_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [PROFILE_DISABLE_EXECUTE_COMMAND_ID]: 'network:profile-disable',
  [PROFILE_DEFAULT_SET_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [PROFILE_GLOBAL_SWITCH_PLAN_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [PROFILE_GLOBAL_SWITCH_APPLY_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [PROFILE_DISABLE_POLICY_SET_EXECUTE_COMMAND_ID]: 'network:profile-disable',
  [PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID]: 'network:profile-disable'
}

// ── Execute body types ─────────────────────────────────────────────────────

/** 审批执行请求体：approvalId 必填，reason 可选 */
export type ApprovalExecuteBody = {
  approvalId: string
  reason?: string
}

/** Profile 执行请求体：networkId 与 profileVersion 必填，reason 可选 */
export type NetworkProfileExecuteBody = {
  networkId: string
  profileVersion: string
  reason?: string
}
