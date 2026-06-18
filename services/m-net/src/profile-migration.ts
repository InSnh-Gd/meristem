import type {
  MNetRegionalProfileFromSchema,
  NetworkProfileStateFromSchema
} from '../../../packages/contracts/src/schemas/mnet-profile.ts'

const SOURCE_CN_PROFILE_VERSION = 'm-net-cn@0.1.0'
const TARGET_CN_PROFILE_VERSION = 'm-net-cn@0.2.0'
const TARGET_PROFILE_SCHEMA_VERSION = 'mnet-profile@0.2.0'

type MNetRegionalProfile = MNetRegionalProfileFromSchema
type NetworkProfileState = NetworkProfileStateFromSchema

export type MigrationProfileCandidate = Omit<
  MNetRegionalProfile,
  'profileVersion' | 'schemaVersion'
> & {
  readonly profileVersion: string
  readonly schemaVersion: string
}

export type MigrationNetworkState = {
  readonly networkId: string
  readonly profileVersion: string
  readonly status: NetworkProfileState
  readonly activeBreakGlass: boolean
  readonly operationStatus: 'idle' | 'in_progress'
  readonly desiredDataPlane?: DataPlaneDesiredState
}

export type DataPlaneDesiredState = {
  readonly networkMapStatus: 'planned' | 'applied'
  readonly tunnelStatus: 'desired' | 'active'
  readonly relayFallback: 'desired' | 'active'
}

export type PlannedMigrationEffect =
  | {
      readonly kind: 'set-network-profile'
      readonly key: string
      readonly networkId: string
      readonly fromProfileVersion: string
      readonly toProfileVersion: string
    }
  | {
      readonly kind: 'provision-data-plane-desired-state'
      readonly key: string
      readonly networkId: string
      readonly profileVersion: typeof TARGET_CN_PROFILE_VERSION
    }
  | {
      readonly kind: 'tear-down-data-plane-desired-state'
      readonly key: string
      readonly networkId: string
      readonly fromProfileVersion: typeof TARGET_CN_PROFILE_VERSION
    }
  | {
      readonly kind: 'preserve-audit-history'
      readonly key: string
      readonly auditIds: readonly string[]
    }
  | {
      readonly kind: 'write-audit-fact'
      readonly key: string
      readonly action: string
      readonly resource: string
      readonly result: string
    }

export type MigrationInput = {
  readonly profile: MigrationProfileCandidate
  readonly network: MigrationNetworkState
  readonly operationId: string
  readonly actor: string
  readonly reason: string
}

export type MigrationUnsupportedVersion = {
  readonly kind: 'unsupported-version'
  readonly error: {
    readonly code: 'profile.version_unsupported'
    readonly profileVersion: string
    readonly supportedSourceVersions: readonly string[]
  }
}

export type MigrationNotEligible = {
  readonly kind: 'not-eligible'
  readonly networkId: string
  readonly reasons: readonly MigrationEligibilityReason[]
  readonly auditRequired: {
    readonly action: 'mnet.profile.migration.not_eligible'
    readonly metadata: Record<string, unknown>
  }
}

export type MigrationSuccess = {
  readonly kind: 'migrated'
  readonly profile: MNetRegionalProfile
  readonly network: MigrationNetworkState
  readonly plannedEffects: readonly PlannedMigrationEffect[]
  readonly audit: {
    readonly action: 'mnet.profile.migration.plan'
    readonly operationId: string
    readonly requiresAudit: true
  }
}

export type MigrationAlreadyApplied = {
  readonly kind: 'already-migrated'
  readonly profile: MNetRegionalProfile
  readonly network: MigrationNetworkState
  readonly plannedEffects: readonly []
}

export type MigrationResult =
  | MigrationSuccess
  | MigrationAlreadyApplied
  | MigrationNotEligible
  | MigrationUnsupportedVersion

export type MigrationEligibilityReason =
  | 'active_break_glass'
  | 'operation_in_progress'
  | 'profile_state_in_transition'

export type MigrationEligibilityResult =
  | { readonly kind: 'eligible'; readonly networkId: string }
  | MigrationNotEligible

export type AuditTrailEntry = {
  readonly auditId: string
  readonly action: string
  readonly recordedAt: string
}

export type RollbackInput = {
  readonly currentProfile: MNetRegionalProfile
  readonly currentNetwork: MigrationNetworkState
  readonly targetControlPlaneProfile: MNetRegionalProfile
  readonly operationId: string
  readonly actor: string
  readonly reason: string
  readonly appliedNetworkMap: boolean
  readonly rotatedNodeKeys: readonly string[]
  readonly auditTrail: readonly AuditTrailEntry[]
}

export type RollbackSuccess = {
  readonly kind: 'rolled-back'
  readonly profile: MNetRegionalProfile
  readonly network: MigrationNetworkState
  readonly plannedEffects: readonly PlannedMigrationEffect[]
  readonly audit: {
    readonly action: 'mnet.profile.migration.rollback'
    readonly preservedAuditIds: readonly string[]
  }
}

export type RollbackIrreversible = {
  readonly kind: 'irreversible'
  readonly reasonCodes: readonly RollbackIrreversibleReason[]
  readonly auditRequired: {
    readonly action: 'mnet.profile.migration.rollback.irreversible'
    readonly operationId: string
    readonly metadata: Record<string, unknown>
  }
}

export type RollbackIrreversibleReason = 'network_map_already_applied' | 'node_keys_already_rotated'

export type RollbackResult = RollbackSuccess | RollbackIrreversible

const supportedSourceVersions = [SOURCE_CN_PROFILE_VERSION, TARGET_CN_PROFILE_VERSION]

const targetRuntimeConfig = {
  headscaleEndpoint: { secretRefId: 'mnet-cn-headscale-endpoint' },
  routingTable: { secretRefId: 'mnet-cn-routing-table' }
}

const desiredDataPlane: DataPlaneDesiredState = {
  networkMapStatus: 'planned',
  tunnelStatus: 'desired',
  relayFallback: 'desired'
}

/**
 * 纯函数迁移入口：只计算 Profile、网络目标态和待执行动作，不写 DB、不发布事件。
 */
export function migrateMNetProfile(input: MigrationInput): MigrationResult {
  if (!isSupportedProfileVersion(input.profile.profileVersion)) {
    return unsupportedVersion(input.profile.profileVersion)
  }

  const eligibility = checkMigrationEligibility({ profile: input.profile, network: input.network })
  if (eligibility.kind === 'not-eligible') return eligibility

  if (
    input.profile.profileVersion === TARGET_CN_PROFILE_VERSION &&
    input.network.profileVersion === TARGET_CN_PROFILE_VERSION
  ) {
    return {
      kind: 'already-migrated',
      profile: toTargetProfile(input.profile),
      network: input.network,
      plannedEffects: []
    }
  }

  const profile = toTargetProfile(input.profile)
  const network = toTargetNetwork(input.network)

  return {
    kind: 'migrated',
    profile,
    network,
    plannedEffects: migrationEffects(input),
    audit: {
      action: 'mnet.profile.migration.plan',
      operationId: input.operationId,
      requiresAudit: true
    }
  }
}

/**
 * 纯函数回滚入口：可安全回滚时生成控制面目标态；不可逆时返回审计所需元数据。
 */
export function rollbackMNetProfile(input: RollbackInput): RollbackResult {
  const irreversibleReasons = rollbackIrreversibleReasons(input)
  const preservedAuditIds = input.auditTrail.map(entry => entry.auditId)

  if (irreversibleReasons.length > 0) {
    return {
      kind: 'irreversible',
      reasonCodes: irreversibleReasons,
      auditRequired: {
        action: 'mnet.profile.migration.rollback.irreversible',
        operationId: input.operationId,
        metadata: {
          networkId: input.currentNetwork.networkId,
          appliedNetworkMap: input.appliedNetworkMap,
          rotatedNodeKeys: input.rotatedNodeKeys,
          preservedAuditIds
        }
      }
    }
  }

  const network = toControlPlaneNetwork(input.currentNetwork, input.targetControlPlaneProfile)

  return {
    kind: 'rolled-back',
    profile: input.targetControlPlaneProfile,
    network,
    plannedEffects: rollbackEffects(input, preservedAuditIds),
    audit: {
      action: 'mnet.profile.migration.rollback',
      preservedAuditIds
    }
  }
}

/**
 * 单网络迁移资格检查：把安全中断和进行中的操作转成显式拒绝原因。
 */
export function checkMigrationEligibility(input: {
  readonly profile: MigrationProfileCandidate
  readonly network: MigrationNetworkState
}): MigrationEligibilityResult {
  const reasons: MigrationEligibilityReason[] = []

  if (input.network.activeBreakGlass) reasons.push('active_break_glass')
  if (input.network.operationStatus === 'in_progress') reasons.push('operation_in_progress')
  if (input.network.status === 'enabling' || input.network.status === 'disabling') {
    reasons.push('profile_state_in_transition')
  }

  if (reasons.length === 0) return { kind: 'eligible', networkId: input.network.networkId }

  return {
    kind: 'not-eligible',
    networkId: input.network.networkId,
    reasons,
    auditRequired: {
      action: 'mnet.profile.migration.not_eligible',
      metadata: {
        networkId: input.network.networkId,
        profileVersion: input.profile.profileVersion,
        reasons
      }
    }
  }
}

function isSupportedProfileVersion(version: string): boolean {
  return version === SOURCE_CN_PROFILE_VERSION || version === TARGET_CN_PROFILE_VERSION
}

function unsupportedVersion(profileVersion: string): MigrationUnsupportedVersion {
  return {
    kind: 'unsupported-version',
    error: {
      code: 'profile.version_unsupported',
      profileVersion,
      supportedSourceVersions
    }
  }
}

function toTargetProfile(profile: MigrationProfileCandidate): MNetRegionalProfile {
  return {
    ...profile,
    profileVersion: TARGET_CN_PROFILE_VERSION,
    region: 'cn',
    displayName: 'M-Net CN (Production Data Plane)',
    schemaVersion: TARGET_PROFILE_SCHEMA_VERSION,
    status: 'available',
    rules: {
      ...profile.rules,
      mainlandNodeWithoutPublicAccess: {
        interconnect: 'wstunnel_relay'
      },
      residency: 'cn-only'
    },
    capabilities: {
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false,
      controlPlaneOnly: false,
      realWireGuardTunnel: true,
      realRelayFallback: true
    },
    runtimeConfig: targetRuntimeConfig
  }
}

function toTargetNetwork(network: MigrationNetworkState): MigrationNetworkState {
  return {
    ...network,
    profileVersion: TARGET_CN_PROFILE_VERSION,
    status: 'enabled',
    desiredDataPlane
  }
}

function migrationEffects(input: MigrationInput): readonly PlannedMigrationEffect[] {
  return [
    {
      kind: 'set-network-profile',
      key: `set-network-profile:${input.network.networkId}:${TARGET_CN_PROFILE_VERSION}`,
      networkId: input.network.networkId,
      fromProfileVersion: input.network.profileVersion,
      toProfileVersion: TARGET_CN_PROFILE_VERSION
    },
    {
      kind: 'provision-data-plane-desired-state',
      key: `provision-data-plane:${input.network.networkId}:${TARGET_CN_PROFILE_VERSION}`,
      networkId: input.network.networkId,
      profileVersion: TARGET_CN_PROFILE_VERSION
    },
    {
      kind: 'write-audit-fact',
      key: `write-audit-fact:${input.operationId}:migration`,
      action: 'mnet.profile.migration.plan',
      resource: `network:${input.network.networkId}`,
      result: 'planned'
    }
  ]
}

function rollbackIrreversibleReasons(input: RollbackInput): readonly RollbackIrreversibleReason[] {
  const reasons: RollbackIrreversibleReason[] = []
  if (input.appliedNetworkMap) reasons.push('network_map_already_applied')
  if (input.rotatedNodeKeys.length > 0) reasons.push('node_keys_already_rotated')
  return reasons
}

function toControlPlaneNetwork(
  network: MigrationNetworkState,
  profile: MNetRegionalProfile
): MigrationNetworkState {
  return {
    networkId: network.networkId,
    profileVersion: profile.profileVersion,
    status: 'disabled',
    activeBreakGlass: false,
    operationStatus: 'idle'
  }
}

function rollbackEffects(
  input: RollbackInput,
  preservedAuditIds: readonly string[]
): readonly PlannedMigrationEffect[] {
  return [
    {
      kind: 'set-network-profile',
      key: `set-network-profile:${input.currentNetwork.networkId}:${SOURCE_CN_PROFILE_VERSION}`,
      networkId: input.currentNetwork.networkId,
      fromProfileVersion: input.currentProfile.profileVersion,
      toProfileVersion: SOURCE_CN_PROFILE_VERSION
    },
    {
      kind: 'tear-down-data-plane-desired-state',
      key: `tear-down-data-plane:${input.currentNetwork.networkId}:${TARGET_CN_PROFILE_VERSION}`,
      networkId: input.currentNetwork.networkId,
      fromProfileVersion: TARGET_CN_PROFILE_VERSION
    },
    {
      kind: 'preserve-audit-history',
      key: `preserve-audit-history:${input.operationId}`,
      auditIds: preservedAuditIds
    },
    {
      kind: 'write-audit-fact',
      key: `write-audit-fact:${input.operationId}:rollback`,
      action: 'mnet.profile.migration.rollback',
      resource: `network:${input.currentNetwork.networkId}`,
      result: 'planned'
    }
  ]
}
