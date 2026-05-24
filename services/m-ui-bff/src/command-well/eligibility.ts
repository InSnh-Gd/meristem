import type { CommandWellEligibility, DisabledCommandExplanation, MNode, Permission } from '../../../../packages/contracts/src/index.ts'

type SessionFacts = {
  permissions: Permission[]
}

function disabledCommand(code: DisabledCommandExplanation['code'], message: string, missingPermission?: Permission): CommandWellEligibility {
  const disabled: DisabledCommandExplanation = {
    code,
    message,
    ...(missingPermission ? { missingPermission } : {})
  }
  return { state: 'disabled', disabled, disabledReason: message }
}

/**
 * Derives CommandWell display eligibility from Core-visible facts only.
 * Source: docs/plans/2026-05-23-architecture-review-register.md A-005.
 */
export function deriveNoopCommandEligibility(session: SessionFacts, node: MNode): CommandWellEligibility {
  if (!session.permissions.includes('task:assign')) {
    return missingPermissionCommandEligibility()
  }
  if (node.kind !== 'leaf') {
    return disabledCommand('wrong_node_kind', '目标不是 Leaf 节点')
  }
  if (node.reachability !== 'reachable') {
    return disabledCommand('node_unreachable', '目标节点不可达')
  }

  return {
    state: 'enabled',
    command: {
      id: 'task.noop.run',
      label: '运行 noop 任务',
      action: 'task:assign',
      resource: node.id,
      risk: 'medium',
      requiredPermissions: ['task:assign'],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/** Returns display-only disabled state when the session lacks task assignment permission. */
export function missingPermissionCommandEligibility(): CommandWellEligibility {
  return disabledCommand('missing_permission', '缺少权限：task:assign', 'task:assign')
}

/** Returns display-only disabled state when the Core node lookup cannot find the target. */
export function targetMissingCommandEligibility(): CommandWellEligibility {
  return disabledCommand('target_missing', '目标节点不存在')
}
