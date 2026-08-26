import type { MNetMigrationRequiredFromSchema } from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import type { ForcedRelayNodeContext } from './forced-relay-node-context.ts'
import {
  isReachable,
  nodeCompatibility,
  profileCompatibility
} from './forced-relay-compatibility.ts'
import { profileWorkflowFailure, type ProfileWorkflowFailure } from './profile-workflow-types.ts'

/** 已通过可达性与 profile 兼容性检查的强制 Relay 目标。 */
export type ResolvedForcedRelayTarget = {
  node: ForcedRelayNodeContext
  networkId: string
  profileVersion: 'm-net-cn@0.3.0'
}
function asMigrationFailure(
  migration: MNetMigrationRequiredFromSchema,
  status: ProfileWorkflowFailure['status'] = 409
): ProfileWorkflowFailure {
  return {
    kind: 'failure',
    ok: false,
    status,
    error: { code: 'migration_required', message: migration.message, migration }
  }
}
/** 解析并验证强制 Relay 所属 Leaf 节点与网络 profile。 */
export async function resolveForcedRelayTarget(
  deps: Pick<MNetAppDeps, 'profileStore' | 'describeForcedRelayNode'>,
  nodeId: string
): Promise<ResolvedForcedRelayTarget | ProfileWorkflowFailure> {
  if (!deps.profileStore || !deps.describeForcedRelayNode)
    return profileWorkflowFailure(
      503,
      'feature.unavailable',
      'forced relay workflow is not available'
    )
  const node = await deps.describeForcedRelayNode(nodeId)
  if (!node) return profileWorkflowFailure(404, 'node.not_found', 'node not found')
  if (!node.networkId || !node.networkProfileVersion)
    return profileWorkflowFailure(404, 'node.not_in_network', 'node is not joined to a network')
  if (node.nodeKind !== 'leaf')
    return profileWorkflowFailure(
      409,
      'forced_relay.wrong_node_kind',
      'forced relay change requires a Leaf node'
    )
  if (!isReachable(node))
    return profileWorkflowFailure(
      409,
      'forced_relay.node_unreachable',
      'selected node is not reachable'
    )
  const networkState = await deps.profileStore.getNetworkState(node.networkId)
  if (!networkState) return profileWorkflowFailure(404, 'network.not_found', 'network not found')
  const compatibility = profileCompatibility(networkState.profileVersion)
  if (!compatibility)
    return profileWorkflowFailure(
      409,
      'forced_relay.unsupported_profile',
      'forced relay change requires an m-net-cn@0.3.0 profile'
    )
  if (compatibility.kind === 'migration_required')
    return asMigrationFailure(compatibility.migration)
  if (compatibility.profile.profileVersion !== 'm-net-cn@0.3.0')
    return profileWorkflowFailure(
      409,
      'forced_relay.unsupported_profile',
      'forced relay change requires an m-net-cn@0.3.0 profile'
    )
  const nodeRuntimeCompatibility = nodeCompatibility(node)
  if (nodeRuntimeCompatibility.kind === 'migration_required')
    return asMigrationFailure(nodeRuntimeCompatibility.migration)
  return { node, networkId: node.networkId, profileVersion: 'm-net-cn@0.3.0' }
}
