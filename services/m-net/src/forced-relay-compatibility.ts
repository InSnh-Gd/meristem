import type {
  MNetNodeV03CompatibilityResultFromSchema,
  MNetProfileV03CompatibilityResultFromSchema
} from '../../../packages/contracts/src/index.ts'
import {
  decodeMNetNodeV03Compatibility,
  decodeMNetProfileV03Compatibility
} from '../../../packages/contracts/src/index.ts'
import type { ForcedRelayNodeContext } from './forced-relay-node-context.ts'

/**
 * forced relay 的 v0.3 兼容性判定：网络 profile 与节点 runtime transport 的
 * 兼容结果归一化（含 bootstrap 兼容 fixture），供 eligibility 与 execute 路径复用。
 */

const LEGACY_NODE_AGENT_CAPABILITY = 'node-agent.wstunnel.v0.2'

function isReachable(node: ForcedRelayNodeContext): boolean {
  return node.reachability === 'reachable' || node.reachability === 'public'
}

function profileCompatibility(
  profileVersion: string
): MNetProfileV03CompatibilityResultFromSchema | null {
  if (profileVersion === 'm-net-cn@0.3.0') {
    return {
      kind: 'profile',
      profile: {
        profileVersion: 'm-net-cn@0.3.0',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'cn',
        displayName: 'CN profile',
        status: 'available',
        capabilities: {
          controlPlaneOnly: false,
          managementPlaneExcluded: true,
          realNetBirdSidecar: true,
          signalConfigRef: { configRef: 'signal/cn-primary' },
          relayConfigRef: { configRef: 'relay/cn-primary' },
          stunConfigRef: { configRef: 'stun/cn-primary' },
          sidecarDesiredState: 'start',
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/cn-sidecar',
            version: 1
          },
          sidecarCredentialStatus: 'ready',
          sidecarHealthStatus: 'healthy'
        },
        forcedTcpRelaySelector: {
          enabled: true,
          selectorOwnership: 'operator',
          selector: {
            selectorType: 'node-ids',
            nodeIds: ['bootstrap-cn-leaf']
          },
          routeClass: 'forced-tcp-relay',
          operatorOverrideAllowed: true,
          operatorOverrideActive: false,
          policyDecision: {
            decisionId: 'bootstrap-policy-decision',
            source: 'm-policy',
            outcome: 'allow',
            reason: 'bootstrap compatibility fixture'
          },
          auditEvidence: {
            auditId: 'bootstrap-audit-id',
            eventId: 'bootstrap-event-id',
            eventSubject: 'mnet.forced_relay.change.v0'
          }
        },
        rules: {
          transport: 'netbird-sidecar',
          mode: 'cn-sidecar',
          relay: {
            selectorMode: 'operator-override',
            defaultRouteClass: 'auto',
            forcedTcpRelay: {
              enabled: true,
              eventSubject: 'mnet.forced_relay.change.v0'
            }
          }
        }
      }
    }
  }
  if (profileVersion === 'm-net@0.3.0') {
    return {
      kind: 'profile',
      profile: {
        profileVersion: 'm-net@0.3.0',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'default',
        displayName: 'Default profile',
        status: 'available',
        capabilities: {
          controlPlaneOnly: false,
          managementPlaneExcluded: true,
          realNetBirdSidecar: true,
          signalConfigRef: { configRef: 'signal/default-primary' },
          relayConfigRef: { configRef: 'relay/default-primary' },
          stunConfigRef: { configRef: 'stun/default-primary' },
          sidecarDesiredState: 'start',
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/default-sidecar',
            version: 1
          },
          sidecarCredentialStatus: 'ready',
          sidecarHealthStatus: 'healthy'
        },
        rules: {
          transport: 'netbird-sidecar',
          mode: 'standard',
          relay: {
            selectorMode: 'automatic',
            defaultRouteClass: 'auto'
          }
        }
      }
    }
  }

  try {
    return decodeMNetProfileV03Compatibility({ profileId: profileVersion, profileVersion })
  } catch {
    return null
  }
}

function nodeCompatibility(node: ForcedRelayNodeContext): MNetNodeV03CompatibilityResultFromSchema {
  return decodeMNetNodeV03Compatibility({
    nodeId: node.nodeId,
    profileVersion:
      node.networkProfileVersion?.startsWith('m-net-cn@') === true
        ? 'm-net-cn@0.3.0'
        : 'm-net@0.3.0',
    transport: node.capabilities.includes(LEGACY_NODE_AGENT_CAPABILITY)
      ? 'wstunnel'
      : 'netbird-sidecar'
  })
}

export { isReachable, nodeCompatibility, profileCompatibility }
