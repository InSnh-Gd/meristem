import type {
  ActorId,
  NodeControlAction,
  NodeControlResponse,
  NodeKind,
  Permission
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  deriveNodeControlTransition,
  deriveNodeRoleSwitch,
  type NodeControlTransition
} from './node-control-state-machine.ts'
import type { NodeControlStore } from './node-control-store.ts'

type NodeControlPolicyAuthorize = NonNullable<MNetAppDeps['policyAuthorize']>
type NodeControlEvents = NonNullable<MNetAppDeps['events']>
type NodeControlLog = NonNullable<MNetAppDeps['log']>

export type NodeControlFailure = {
  kind: 'failure'
  status: 403 | 404 | 409 | 503
  error: { code: string; message: string }
}

export type NodeControlDeps = {
  store: NodeControlStore
  policyAuthorize: NodeControlPolicyAuthorize
  events?: NodeControlEvents
  log?: NodeControlLog
}

export function isNodeControlFailure(value: unknown): value is NodeControlFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    // 运行时类型守卫：'kind' in value 之后 TS 仍无法收窄属性类型，需要显式断言读取字段。
    (value as { kind?: string }).kind === 'failure'
  )
}

function nodeControlFailure(
  status: NodeControlFailure['status'],
  code: string,
  message: string
): NodeControlFailure {
  return { kind: 'failure', status, error: { code, message } }
}

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

async function executeNodeRoleSwitch(
  deps: NodeControlDeps,
  input: {
    actor: ActorId
    nodeId: string
    action: NodeControlAction
    reason: string
    targetKind?: NodeKind
  },
  node: { id: string; kind: NodeKind }
): Promise<NodeControlResponse | NodeControlFailure> {
  if (!deps.log) {
    return nodeControlFailure(503, 'audit.unavailable', 'audit log is required')
  }

  const memberships = await deps.store.listMemberships(input.nodeId)
  const networksWithoutSiblingStem = await deps.store.listNetworksWithoutSiblingStem({
    nodeId: input.nodeId,
    networkIds: memberships.map(membership => membership.networkId)
  })
  const roleSwitch = deriveNodeRoleSwitch(
    node.kind,
    input.targetKind,
    networksWithoutSiblingStem.length === 0 ? 1 : 0
  )
  if (!roleSwitch.ok) {
    return nodeControlFailure(409, roleSwitch.code, roleSwitch.message)
  }

  const policyResult = await deps.policyAuthorize.authorize(
    input.actor,
    'node:switch-role',
    `node:${input.nodeId}`
  )
  if (policyResult.result !== 'allow') {
    const deniedCorrelationId = crypto.randomUUID()
    try {
      await deps.log.writeAudit(
        input.actor,
        'node.switch-role.request',
        `node:${input.nodeId}`,
        'deny',
        deniedCorrelationId,
        {
          previousKind: node.kind,
          requestedKind: input.targetKind,
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
      `node switch-role denied: ${policyResult.reasons.join(', ')}`
    )
  }

  const controlCorrelationId = crypto.randomUUID()
  try {
    await deps.log.writeAudit(
      input.actor,
      'node.switch-role.request',
      `node:${input.nodeId}`,
      'allow',
      controlCorrelationId,
      {
        previousKind: node.kind,
        nextKind: roleSwitch.nextKind,
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

  const updatedNode = await deps.store.updateRole(input.nodeId, roleSwitch.nextKind)
  if (!updatedNode) {
    return nodeControlFailure(404, 'node.not_found', 'node not found')
  }

  try {
    await deps.events?.publish(
      'node.role.changed.v0',
      'node.role.changed',
      {
        nodeId: input.nodeId,
        previousKind: node.kind,
        nextKind: roleSwitch.nextKind,
        reason: 'operator_switch-role'
      },
      controlCorrelationId
    )
    await deps.log.writeTimeline(
      `node role switch applied for ${input.nodeId}`,
      'node.role.changed',
      controlCorrelationId
    )
    await deps.log.writeFull(
      'info',
      `node role switch completed for ${input.nodeId}`,
      controlCorrelationId,
      {
        previousKind: node.kind,
        nextKind: roleSwitch.nextKind,
        policyDecisionId: policyResult.id,
        reason: input.reason
      }
    )
    await deps.log.writeAudit(
      input.actor,
      'node.switch-role.success',
      `node:${input.nodeId}`,
      'success',
      controlCorrelationId,
      {
        previousKind: node.kind,
        nextKind: roleSwitch.nextKind,
        reason: input.reason,
        policyDecisionId: policyResult.id
      }
    )
  } catch (error) {
    await deps.store.updateRole(input.nodeId, node.kind)
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
