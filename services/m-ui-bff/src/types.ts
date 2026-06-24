import type {
  CommandWellEligibilityFromSchema as CommandWellEligibility,
  NodeControlAction,
  OperationalCommandPreviewFromSchema as OperationalCommandPreview,
  OperationalCommandPreviewCommandIdFromSchema as OperationalCommandPreviewCommandId,
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

export type MNetJoinTicketCreateBody = {
  kind: 'stem' | 'leaf'
  name: string
  capabilities?: string[]
  expiresInSeconds?: number
}

export type MNetCredentialTargetBody = {
  networkId: string
  nodeId: string
}

export type MNetCredentialRevokeBody = MNetCredentialTargetBody & {
  reason?: string
}

export type MNetNodeControlBody = {
  nodeId: string
  reason?: string
}

export type MNetProfileToggleBody = {
  networkId: string
  profileVersion: string
  reason?: string
}

export type MNetBreakGlassBody = {
  networkId: string
  confirmation: string
  emergencyReason?: string
}

export type MNetDefaultsSetBody = {
  profileVersion: string
  reason?: string
  idempotencyKey?: string
}

export type MNetMigrationDryRunBody = {
  targetProfileVersion: string
  batchSize?: number
  reason?: string
  idempotencyKey?: string
}

export type MNetMigrationOperationBody = {
  operationId: string
}

export type MNetMigrationRollbackBody = {
  operationId: string
  reason?: string
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
  | { networkId: string }
  | { scope?: string }
  | MNetCredentialTargetBody
  | MNetNodeControlBody

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
/** M-Net join ticket 创建执行命令 ID */
export const MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID = 'network.join-ticket.create.execute'
/** M-Net 节点凭证签发执行命令 ID */
export const MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID = 'network.node-credential.issue.execute'
/** M-Net 节点凭证轮换执行命令 ID */
export const MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID =
  'network.node-credential.rotate.execute'
/** M-Net 节点凭证吊销执行命令 ID */
export const MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID =
  'network.node-credential.revoke.execute'
/** M-Net Profile 启用执行命令 ID */
export const MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID = 'network.dataplane-profile.enable.execute'
/** M-Net Profile 停用执行命令 ID */
export const MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID = 'network.dataplane-profile.disable.execute'
/** M-Net break-glass 执行命令 ID */
export const MNET_BREAK_GLASS_EXECUTE_COMMAND_ID = 'network.break-glass.execute'
/** M-Net 默认设置执行命令 ID */
export const MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID = 'network.defaults.set.execute'
/** M-Net 迁移规划执行命令 ID */
export const MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID = 'network.migration.dry-run.execute'
/** M-Net 迁移应用执行命令 ID */
export const MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID = 'network.migration.apply.execute'
/** M-Net 迁移恢复执行命令 ID */
export const MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID = 'network.migration.resume.execute'
/** M-Net 迁移回滚执行命令 ID */
export const MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID = 'network.migration.rollback.execute'
/** 节点禁用执行命令 ID */
export const NODE_DISABLE_EXECUTE_COMMAND_ID = 'node.disable.execute'
/** 节点隔离执行命令 ID */
export const NODE_ISOLATE_EXECUTE_COMMAND_ID = 'node.isolate.execute'
/** 节点恢复执行命令 ID */
export const NODE_RECOVER_EXECUTE_COMMAND_ID = 'node.recover.execute'

/** 节点控制命令 ID 与后端 action 的显式映射，避免 UI/BFF 拼接契约字符串。 */
export const NODE_CONTROL_COMMAND_ACTIONS = {
  [NODE_DISABLE_EXECUTE_COMMAND_ID]: 'disable',
  [NODE_ISOLATE_EXECUTE_COMMAND_ID]: 'isolate',
  [NODE_RECOVER_EXECUTE_COMMAND_ID]: 'recover'
} as const satisfies Record<string, NodeControlAction>

export type NodeControlExecuteCommandId = keyof typeof NODE_CONTROL_COMMAND_ACTIONS

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
  PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID,
  MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID,
  MNET_BREAK_GLASS_EXECUTE_COMMAND_ID,
  MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID,
  NODE_DISABLE_EXECUTE_COMMAND_ID,
  NODE_ISOLATE_EXECUTE_COMMAND_ID,
  NODE_RECOVER_EXECUTE_COMMAND_ID
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
  [PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID]: 'network:profile-disable',
  [MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID]: 'node:register',
  [MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID]: 'node:issue-token',
  [MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID]: 'node:issue-token',
  [MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID]: 'node:issue-token',
  [MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID]: 'network:profile-disable',
  [MNET_BREAK_GLASS_EXECUTE_COMMAND_ID]: 'network:profile-disable',
  [MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID]: 'network:profile-enable',
  [NODE_DISABLE_EXECUTE_COMMAND_ID]: 'node:disable',
  [NODE_ISOLATE_EXECUTE_COMMAND_ID]: 'node:isolate',
  [NODE_RECOVER_EXECUTE_COMMAND_ID]: 'node:recover'
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
