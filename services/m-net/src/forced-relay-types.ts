import type {
  CommandWellEligibilityFromSchema,
  MNetOperationalEventIngestResponseFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'

/** 强制 Relay CommandWell 展示态所需依赖。 */
export type ForcedRelayEligibilityDeps = Pick<
  MNetAppDeps,
  'profileStore' | 'describeForcedRelayNode'
>
/** 强制 Relay 执行、策略、审计与事件发布所需依赖。 */
export type ForcedRelayExecuteDeps = Pick<
  MNetAppDeps,
  'profileStore' | 'policyAuthorize' | 'log' | 'ingestOperationalEvent' | 'describeForcedRelayNode'
>
/** 强制 Relay 操作员命令体。 */
export type ForcedRelayExecuteBody = { nodeId: string; reason?: string }
/** 强制 Relay 命令成功结果。 */
export type ForcedRelayCommandResult = {
  status: 'applied'
  networkId: string
  nodeId: string
  profileVersion: 'm-net-cn@0.3.0'
  routeClass: 'forced-tcp-relay'
  selectorOwnership: 'operator'
  affectedNodeIds: string[]
  policyDecisionId: string
  auditId: string
  eventId: string
  correlationId: string
  publishStatus: MNetOperationalEventIngestResponseFromSchema['publishStatus']
  snapshotStatus: MNetOperationalEventIngestResponseFromSchema['snapshotStatus']
}
/** 强制 Relay 命令标识。 */
export const FORCED_RELAY_COMMAND_ID = 'network.forced-relay.change.execute'
/** 强制 Relay 命令显示名称。 */
export const FORCED_RELAY_LABEL = '切换强制 Relay 类'
/** 强制 Relay 所需策略动作。 */
export const FORCED_RELAY_ACTION = 'network:profile-enable'
/** 旧版 Wstunnel Agent 能力标识。 */
export const LEGACY_NODE_AGENT_CAPABILITY = 'node-agent.wstunnel.v0.2'
/** CommandWell 可用命令类型。 */
export type EnabledForcedRelayCommand = Extract<
  CommandWellEligibilityFromSchema,
  { state: 'enabled' }
>['command']
