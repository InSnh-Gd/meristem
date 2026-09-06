import type { MNetworkMember } from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type {
  GlobalDefaultsStore,
  NetworkProfileMigrationResult,
  SwitchBatch,
  SwitchOperationStatus
} from './global-defaults-store.ts'

export type { NetworkProfileMigrationResult, SwitchBatch, SwitchOperationStatus }

import type { NetworkSnapshot } from './migration-engine-helpers.ts'
import type { MigrationProfileCandidate } from './profile-migration.ts'
import type { ProfileStore } from './profile-store.ts'

/**
 * 迁移引擎的纯契约与纯映射：deps 端口、目标版本常量、result helpers 和
 * legacy → v0.3 候选 profile 映射。IO 编排见 migration-engine-apply.ts，
 * 锁与迁移存储访问见 migration-engine-locks.ts，rollback 见 migration-engine-rollback.ts。
 */

export type MigrationEngineDeps = {
  globalDefaultsStore: GlobalDefaultsStore
  profileStore: ProfileStore
  dataPlane: DataPlaneStores
  listMembers?: (input: {
    networkId: string
  }) => Promise<
    { ok: true; value: MNetworkMember[] } | { ok: false; error: { code: string; message: string } }
  >
  writeAudit: (input: {
    actor: string
    action: string
    resource: string
    result: string
    correlationId: string
    metadata?: unknown
  }) => Promise<string | undefined>
  writeFull: (input: {
    level: string
    message: string
    correlationId: string
    metadata?: unknown
  }) => Promise<void>
  writeTimeline?: (input: {
    summary: string
    subject: string
    correlationId: string
  }) => Promise<void>
}

export const TARGET_CN_PROFILE_VERSION = 'm-net-cn@0.3.0'

export type PlanMigrationResult = {
  operationId: string
  candidateCount: number
  candidates: string[]
  batches: SwitchBatch[]
}

export const ok = <T>(value: T) => ({ ok: true as const, value })
export const fail = (error: string) => ({ ok: false as const, error })

/** 将网络快照映射为迁移引擎可执行的候选 profile（legacy control-plane / v0.3 NetBird sidecar）。 */
export function toMigrationProfileCandidate(state: NetworkSnapshot): MigrationProfileCandidate {
  if (state.profileVersion === TARGET_CN_PROFILE_VERSION) {
    return {
      profileVersion: TARGET_CN_PROFILE_VERSION,
      region: 'cn',
      displayName: 'M-Net CN (v0.3)',
      schemaVersion: 'mnet-profile@0.3.0',
      status: 'available',
      rules: {
        mainlandNodeWithoutPublicAccess: {
          interconnect: 'netbird_sidecar'
        },
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
      mainlandNodeWithoutPublicAccess: {
        interconnect: 'wstunnel_relay'
      },
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
