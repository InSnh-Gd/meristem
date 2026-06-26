import type {
  ActorId,
  NodeControlAction,
  NodeControlResponse,
  NodeKind,
  Permission
} from '../../../packages/contracts/src/index.ts'
import {
  deriveNodeControlTransition,
  type NodeControlTransition
} from './node-control-state-machine.ts'
import {
  type NodeControlDeps,
  type NodeControlFailure,
  isNodeControlFailure,
  nodeControlFailure
} from './node-control-shared.ts'
import { executeNodeRoleSwitch } from './node-role-switch-workflow.ts'

// 公共 API 重新导出，保持路由层和测试文件不需要修改 import 路径。
export { isNodeControlFailure, type NodeControlFailure, type NodeControlDeps }

function permissionForAction(action: NodeControlAction): Permission {
  switch (action) {
    case 'switch-role':
      return 'node:switch-role'
    case 'disable':
      return 'node:disable'
    case 'isolate':
      return 'node:isolate'
    case 'recover':
      return 'node:recover'
  }
}

function auditActionForStage(action: NodeControlAction, stage: 'request' | 'success'): string {
  return `node.${action}.${stage}`
}

function timelineSummary(action: NodeControlAction, nodeId: string): string {
  return `node ${action} applied for ${nodeId}`
}

function fullMessage(action: NodeControlAction, nodeId: string): string {
  return `node ${action} state transition completed for ${nodeId}`
}

/**
 * 节点控制工作流负责策略判定、状态迁移、事件/日志/审计写入；路由层只做鉴权与响应映射。
 * 角色切换（switch-role）语义独立，委托到 node-role-switch-workflow.ts。
 */
export async function executeNodeControl(
  deps: NodeControlDeps,
  input: {
    actor: ActorId
    nodeId: string
    action: NodeControlAction
    reason: string
    targetKind?: NodeKind
  }
): Promise<NodeControlResponse | NodeControlFailure> {
  const node = await deps.store.get(input.nodeId)
  if (!node) {
    return nodeControlFailure(404, 'node.not_found', 'node not found')
  }

  if (input.action === 'switch-role') {
    return executeNodeRoleSwitch(deps, input, node)
  }

  const transition: NodeControlTransition = deriveNodeControlTransition(node.status, input.action)
  if (!transition.ok) {
    return nodeControlFailure(409, transition.code, transition.message)
  }

  if (!deps.log) {
    return nodeControlFailure(503, 'audit.unavailable', 'audit log is required')
  }

  const permission = permissionForAction(input.action)
  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    permission,
    `node:${input.nodeId}`
  )
  if (policyResult.result !== 'allow') {
    const deniedCorrelationId = crypto.randomUUID()
    try {
      await deps.log.writeAudit(
        input.actor,
        auditActionForStage(input.action, 'request'),
        `node:${input.nodeId}`,
        'deny',
        deniedCorrelationId,
        {
          previousStatus: node.status,
          requestedStatus: transition.nextStatus,
          reason: input.reason,
          policyDecisionId: policyResult.id,
          policyReasons: policyResult.reasons
        }
      )
    } catch (error) {
      return nodeControlFailure(
        503,
        'audit.write_failed',
        error instanceof Error ? error.message : String(error)
      )
    }
    return nodeControlFailure(
      403,
      'policy.denied',
      `node ${input.action} denied: ${policyResult.reasons.join(', ')}`
    )
  }

  const controlCorrelationId = crypto.randomUUID()

  try {
    await deps.log.writeAudit(
      input.actor,
      auditActionForStage(input.action, 'request'),
      `node:${input.nodeId}`,
      'allow',
      controlCorrelationId,
      {
        previousStatus: node.status,
        nextStatus: transition.nextStatus,
        reason: input.reason,
        policyDecisionId: policyResult.id
      }
    )
  } catch (error) {
    return nodeControlFailure(
      503,
      'audit.write_failed',
      error instanceof Error ? error.message : String(error)
    )
  }

  const updatedNode = await deps.store.updateStatus(input.nodeId, transition.nextStatus)
  if (!updatedNode) {
    return nodeControlFailure(404, 'node.not_found', 'node not found')
  }

  try {
    await deps.events?.publish(
      'node.status.changed.v0',
      'node.status.changed',
      {
        nodeId: input.nodeId,
        previousStatus: node.status,
        nextStatus: transition.nextStatus,
        reason: `operator_${input.action}`
      },
      controlCorrelationId
    )
    await deps.log.writeTimeline(
      timelineSummary(input.action, input.nodeId),
      'node.status.changed',
      controlCorrelationId
    )
    await deps.log.writeFull(
      'info',
      fullMessage(input.action, input.nodeId),
      controlCorrelationId,
      {
        previousStatus: node.status,
        nextStatus: transition.nextStatus,
        policyDecisionId: policyResult.id,
        reason: input.reason
      }
    )
    await deps.log.writeAudit(
      input.actor,
      auditActionForStage(input.action, 'success'),
      `node:${input.nodeId}`,
      'success',
      controlCorrelationId,
      {
        previousStatus: node.status,
        nextStatus: transition.nextStatus,
        reason: input.reason,
        policyDecisionId: policyResult.id
      }
    )
  } catch (error) {
    await deps.store.updateStatus(input.nodeId, node.status)
    return nodeControlFailure(
      503,
      'node.control.side_effect_failed',
      error instanceof Error ? error.message : String(error)
    )
  }

  return {
    node: updatedNode,
    policyDecisionId: policyResult.id,
    correlationId: controlCorrelationId
  }
}
