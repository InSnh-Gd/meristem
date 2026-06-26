import type {
  ActorId,
  NodeControlAction,
  NodeControlResponse,
  NodeKind
} from '../../../packages/contracts/src/index.ts'
import { deriveNodeRoleSwitch } from './node-control-state-machine.ts'
import {
  type NodeControlDeps,
  type NodeControlFailure,
  nodeControlFailure
} from './node-control-shared.ts'

/**
 * 角色切换工作流与 disable/isolate/recover 语义不同（操作 kind 而非 status），
 * 独立成文件以便单独测试和维护。
 */
export async function executeNodeRoleSwitch(
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
  // siblingStemCount 语义：存在网络会因本次切换失去最后一个 stem 时传 0（阻止），
  // 所有网络都有其他 stem 时传 1（允许）。listNetworksWithoutSiblingStem 返回
  // 的是"只有当前节点一个 stem"的网络列表，非空意味着切换后该网络 stem 数为 0。
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
