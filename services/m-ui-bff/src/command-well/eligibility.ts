import type {
  CommandWellEligibilityFromSchema as CommandWellEligibility,
  DisabledCommandExplanationFromSchema as DisabledCommandExplanation,
  MNode,
  Permission
} from '../../../../packages/contracts/src/index.ts'
import {
  NODE_CONTROL_COMMAND_ACTIONS,
  NODE_DISABLE_EXECUTE_COMMAND_ID,
  NODE_ISOLATE_EXECUTE_COMMAND_ID,
  NODE_RECOVER_EXECUTE_COMMAND_ID,
  type NodeControlExecuteCommandId
} from '../types.ts'

type SessionFacts = {
  permissions: readonly Permission[]
}

type DisabledCommandEligibility = Extract<CommandWellEligibility, { state: 'disabled' }>

function disabledCommand(
  code: DisabledCommandExplanation['code'],
  message: string,
  missingPermission?: Permission
): DisabledCommandEligibility {
  const disabled: DisabledCommandExplanation = {
    code,
    message,
    ...(missingPermission ? { missingPermission } : {})
  }
  return { state: 'disabled', disabled, disabledReason: message }
}

const NODE_CONTROL_COMMAND_METADATA: Record<
  NodeControlExecuteCommandId,
  {
    label: string
    permission: Permission
    allowedStatuses: readonly MNode['status'][]
  }
> = {
  [NODE_DISABLE_EXECUTE_COMMAND_ID]: {
    label: '禁用节点',
    permission: 'node:disable',
    allowedStatuses: ['healthy', 'degraded', 'offline']
  },
  [NODE_ISOLATE_EXECUTE_COMMAND_ID]: {
    label: '隔离节点',
    permission: 'node:isolate',
    allowedStatuses: ['healthy', 'degraded', 'offline']
  },
  [NODE_RECOVER_EXECUTE_COMMAND_ID]: {
    label: '恢复节点',
    permission: 'node:recover',
    allowedStatuses: ['disabled', 'isolated']
  }
}

export type NodeControlCommandEligibility =
  | DisabledCommandEligibility
  | {
      state: 'enabled'
      command: {
        id: NodeControlExecuteCommandId
        label: string
        action: Permission
        resource: string
        risk: 'high'
        requiredPermissions: readonly Permission[]
        requiresPolicy: true
        requiresAudit: true
      }
    }

export function isNodeControlExecuteCommandId(
  commandId: string
): commandId is NodeControlExecuteCommandId {
  return (
    commandId === NODE_DISABLE_EXECUTE_COMMAND_ID ||
    commandId === NODE_ISOLATE_EXECUTE_COMMAND_ID ||
    commandId === NODE_RECOVER_EXECUTE_COMMAND_ID
  )
}

function blockedNodeStatusMessage(status: MNode['status']): string | null {
  if (status === 'disabled') return '节点已禁用，不能运行任务'
  if (status === 'isolated') return '节点已隔离，不能运行任务'
  if (status === 'recovering') return '节点正在恢复，等待有效 heartbeat 后才能运行任务'
  return null
}

/**
 * Derives CommandWell display eligibility from Core-visible facts only.
 * 来源：`docs/ui/SDUI-SCHEMA.md` 的 CommandWell 边界和 BFF 显示契约。
 */
export function deriveNoopCommandEligibility(
  session: SessionFacts,
  node: MNode
): CommandWellEligibility {
  if (!session.permissions.includes('task:submit')) {
    return missingPermissionCommandEligibility()
  }
  if (node.kind !== 'leaf') {
    return disabledCommand('wrong_node_kind', '目标不是 Leaf 节点')
  }
  const statusBlockReason = blockedNodeStatusMessage(node.status)
  if (statusBlockReason) {
    return disabledCommand('node_unreachable', statusBlockReason)
  }
  if (node.reachability !== 'reachable') {
    return disabledCommand('node_unreachable', '目标节点不可达')
  }

  return {
    state: 'enabled',
    command: {
      id: 'task.noop.run',
      label: '运行 noop 任务',
      action: 'task:submit',
      resource: node.id,
      risk: 'medium',
      requiredPermissions: ['task:submit'],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/** 节点行政控制命令只派生展示态；最终策略、审计和状态机仍由 M-Net 后端执行。 */
export function deriveNodeControlCommandEligibility(
  session: SessionFacts,
  node: MNode,
  commandId: NodeControlExecuteCommandId
): NodeControlCommandEligibility {
  const metadata = NODE_CONTROL_COMMAND_METADATA[commandId]
  if (!session.permissions.includes(metadata.permission)) {
    return disabledCommand(
      'missing_permission',
      `缺少权限：${metadata.permission}`,
      metadata.permission
    )
  }

  if (!metadata.allowedStatuses.includes(node.status)) {
    const action = NODE_CONTROL_COMMAND_ACTIONS[commandId]
    let controlledStatus = `节点状态 ${node.status}`
    if (node.status === 'disabled' || node.status === 'isolated' || node.status === 'recovering') {
      controlledStatus = `节点当前为 ${node.status}`
    }
    return disabledCommand('node_unreachable', `${controlledStatus}，不能执行 ${action}`)
  }

  return {
    state: 'enabled',
    command: {
      id: commandId,
      label: metadata.label,
      action: metadata.permission,
      resource: node.id,
      risk: 'high',
      requiredPermissions: [metadata.permission],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/** Returns display-only disabled state when the session lacks task submit permission. */
export function missingPermissionCommandEligibility(): CommandWellEligibility {
  return disabledCommand('missing_permission', '缺少权限：task:submit', 'task:submit')
}

/** Returns display-only disabled state when the Core node lookup cannot find the target. */
export function targetMissingCommandEligibility(): CommandWellEligibility {
  return disabledCommand('target_missing', '目标节点不存在')
}
