import { TARGET_CN_PROFILE_VERSION } from './migration-engine-types.ts'
import type { NetworkSnapshot } from './migration-engine-helpers.ts'
import type { MigrationProfileCandidate } from './profile-migration.ts'

/** 将已存网络状态转换为 profile 迁移器可判定的候选描述。 */
export function toMigrationProfileCandidate(state: NetworkSnapshot): MigrationProfileCandidate {
  if (state.profileVersion === TARGET_CN_PROFILE_VERSION) {
    return {
      profileVersion: TARGET_CN_PROFILE_VERSION,
      region: 'cn',
      displayName: 'M-Net CN (v0.3)',
      schemaVersion: 'mnet-profile@0.3.0',
      status: 'available',
      rules: {
        mainlandNodeWithoutPublicAccess: { interconnect: 'netbird_sidecar' },
        residency: 'cn-only'
      },
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
        selectorOwnership: 'policy',
        selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
        routeClass: 'forced-tcp-relay',
        operatorOverrideAllowed: false,
        operatorOverrideActive: false,
        policyDecision: {
          decisionId: 'mnet-profile-migration',
          source: 'm-policy',
          outcome: 'allow',
          reason: 'legacy CN profile migrated to NetBird sidecar profile'
        },
        auditEvidence: {
          auditId: 'mnet-profile-migration',
          eventId: 'mnet-profile-migration',
          eventSubject: 'mnet.forced_relay.change.v0'
        }
      }
    }
  }

  return {
    profileVersion: state.profileVersion,
    region: 'cn',
    displayName: 'M-Net CN (legacy control plane)',
    schemaVersion: 'mnet-profile@0.1.0',
    status: 'available',
    rules: {
      mainlandNodeWithoutPublicAccess: { interconnect: 'wstunnel_relay' },
      residency: 'cn-only'
    },
    capabilities: {
      controlPlaneOnly: true,
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false
    }
  }
}
