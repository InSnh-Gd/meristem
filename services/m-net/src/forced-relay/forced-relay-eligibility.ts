import type {
  CommandWellEligibilityFromSchema,
  MNetMigrationRequiredFromSchema
} from '../../../../packages/contracts/src/index.ts'
import { isMigrationRequiredFailure } from '../migration/migration-required-support.ts'
import { resolveForcedRelayTarget } from './forced-relay-target.ts'
import {
  type EnabledForcedRelayCommand,
  FORCED_RELAY_ACTION,
  FORCED_RELAY_COMMAND_ID,
  FORCED_RELAY_LABEL,
  type ForcedRelayEligibilityDeps
} from './forced-relay-types.ts'

type ForcedRelayDisabledCode =
  | 'missing_permission'
  | 'target_missing'
  | 'wrong_node_kind'
  | 'unreachable_node'
  | 'migration_required'
function forcedRelayCommand(resource: string): EnabledForcedRelayCommand {
  return {
    id: FORCED_RELAY_COMMAND_ID,
    label: FORCED_RELAY_LABEL,
    action: FORCED_RELAY_ACTION,
    resource,
    risk: 'high',
    requiredPermissions: [FORCED_RELAY_ACTION],
    requiresPolicy: true,
    requiresAudit: true
  }
}
function disabledEligibility(
  code: ForcedRelayDisabledCode,
  message: string,
  migration?: MNetMigrationRequiredFromSchema
): Extract<CommandWellEligibilityFromSchema, { state: 'disabled' }> {
  return {
    state: 'disabled',
    disabled: { code, message, ...(migration ? { migration } : {}) },
    disabledReason: message
  }
}
/** 仅按公开事实计算强制 Relay CommandWell 展示态，不提前执行策略。 */
export async function deriveForcedRelayEligibility(
  deps: ForcedRelayEligibilityDeps,
  input: { nodeId: string }
): Promise<CommandWellEligibilityFromSchema> {
  const resolved = await resolveForcedRelayTarget(deps, input.nodeId)
  if ('kind' in resolved) {
    if (resolved.status === 404)
      return disabledEligibility('target_missing', resolved.error.message)
    if (isMigrationRequiredFailure(resolved))
      return disabledEligibility(
        'migration_required',
        resolved.error.message,
        resolved.error.migration
      )
    if (resolved.error.code === 'forced_relay.wrong_node_kind')
      return disabledEligibility('wrong_node_kind', '目标不是 Leaf 节点')
    if (resolved.error.code === 'forced_relay.node_unreachable')
      return disabledEligibility('unreachable_node', '目标节点不可达')
    return disabledEligibility('wrong_node_kind', resolved.error.message)
  }
  return {
    state: 'enabled',
    command: forcedRelayCommand(`network/${resolved.networkId}/node/${resolved.node.nodeId}`)
  }
}
