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

export type GenericCommandEligibilityBody =
  | {
      leafNodeId: string
    }
  | ApprovalPreviewBody
  | NetworkProfilePreviewBody

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
