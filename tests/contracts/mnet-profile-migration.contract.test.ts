import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MNetRegionalProfileSchema,
  type NetworkProfileStateFromSchema
} from '../../packages/contracts/src/schemas/mnet-profile.ts'
import type { MNetRegionalProfile } from '../../packages/contracts/src/types/mnet-profile.ts'
import { decodeMNetProfileV03Compatibility } from '../../packages/contracts/src/schemas/mnet-profile-v03.ts'

type MigrationProfileCandidate = Omit<
  MNetRegionalProfile,
  'profileVersion' | 'schemaVersion' | 'capabilities' | 'forcedTcpRelaySelector'
> & {
  readonly profileVersion: string
  readonly schemaVersion: string
  readonly capabilities:
    | {
        readonly controlPlaneOnly: true
        readonly realWstunnelRelay: false
        readonly realTcpInterconnect: false
        readonly realUdpPathSwitching: false
      }
    | MNetRegionalProfile['capabilities']
  readonly forcedTcpRelaySelector?: Extract<
    MNetRegionalProfile,
    { profileVersion: 'm-net-cn@0.3.0' }
  >['forcedTcpRelaySelector']
}

type MigrationNetworkState = {
  readonly networkId: string
  readonly profileVersion: string
  readonly status: NetworkProfileStateFromSchema
  readonly activeBreakGlass: boolean
  readonly operationStatus: 'idle' | 'in_progress'
  readonly desiredDataPlane?: {
    readonly networkMapStatus: 'planned' | 'applied'
    readonly tunnelStatus: 'desired' | 'active'
    readonly relayFallback: 'desired' | 'active'
  }
}

type PlannedMigrationEffect =
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
      readonly profileVersion: 'm-net-cn@0.3.0'
    }
  | {
      readonly kind: 'tear-down-data-plane-desired-state'
      readonly key: string
      readonly networkId: string
      readonly fromProfileVersion: 'm-net-cn@0.3.0'
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

type AuditTrailEntry = {
  readonly auditId: string
  readonly action: string
  readonly recordedAt: string
}

type MigrationInput = {
  readonly profile: MigrationProfileCandidate
  readonly network: MigrationNetworkState
  readonly operationId: string
  readonly actor: string
  readonly reason: string
}

type MigrationResult =
  | {
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
  | {
      readonly kind: 'already-migrated'
      readonly profile: MNetRegionalProfile
      readonly network: MigrationNetworkState
      readonly plannedEffects: readonly []
    }
  | {
      readonly kind: 'not-eligible'
      readonly networkId: string
      readonly reasons: readonly string[]
      readonly auditRequired: {
        readonly action: 'mnet.profile.migration.not_eligible'
        readonly metadata: Record<string, unknown>
      }
    }
  | {
      readonly kind: 'unsupported-version'
      readonly error: {
        readonly code: 'profile.version_unsupported'
        readonly profileVersion: string
        readonly supportedSourceVersions: readonly string[]
      }
    }

type RollbackInput = {
  readonly currentProfile: MNetRegionalProfile
  readonly currentNetwork: MigrationNetworkState
  readonly targetControlPlaneProfile: MigrationProfileCandidate
  readonly operationId: string
  readonly actor: string
  readonly reason: string
  readonly appliedNetworkMap: boolean
  readonly rotatedNodeKeys: readonly string[]
  readonly auditTrail: readonly AuditTrailEntry[]
}

type RollbackResult =
  | {
      readonly kind: 'rolled-back'
      readonly profile: MigrationProfileCandidate
      readonly network: MigrationNetworkState
      readonly plannedEffects: readonly PlannedMigrationEffect[]
      readonly audit: {
        readonly action: 'mnet.profile.migration.rollback'
        readonly preservedAuditIds: readonly string[]
      }
    }
  | {
      readonly kind: 'irreversible'
      readonly reasonCodes: readonly string[]
      readonly auditRequired: {
        readonly action: 'mnet.profile.migration.rollback.irreversible'
        readonly operationId: string
        readonly metadata: Record<string, unknown>
      }
    }

type EligibilityInput = Pick<MigrationInput, 'network' | 'profile'>

type EligibilityResult =
  | { readonly kind: 'eligible'; readonly networkId: string }
  | {
      readonly kind: 'not-eligible'
      readonly networkId: string
      readonly reasons: readonly string[]
      readonly auditRequired: {
        readonly action: 'mnet.profile.migration.not_eligible'
        readonly metadata: Record<string, unknown>
      }
    }

type MigrationModule = {
  readonly migrateMNetProfile: (input: MigrationInput) => MigrationResult
  readonly rollbackMNetProfile: (input: RollbackInput) => RollbackResult
  readonly checkMigrationEligibility: (input: EligibilityInput) => EligibilityResult
}

const migrationModulePath = '../../services/m-net/src/profile-migration.ts'

async function loadMigrationModule(): Promise<MigrationModule> {
  try {
    const moduleValue: unknown = await import(migrationModulePath)
    if (isMigrationModule(moduleValue)) return moduleValue
    throw new Error('profile migration module does not export the required pure functions')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`profile migration implementation missing or invalid: ${message}`)
  }
}

function isMigrationModule(value: unknown): value is MigrationModule {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof Reflect.get(value, 'migrateMNetProfile') === 'function' &&
    typeof Reflect.get(value, 'rollbackMNetProfile') === 'function' &&
    typeof Reflect.get(value, 'checkMigrationEligibility') === 'function'
  )
}

async function loadGoldenLegacyProfile(): Promise<MigrationProfileCandidate> {
  const compatibility = decodeMNetProfileV03Compatibility({
    profileVersion: 'm-net-cn@0.1.0',
    displayName: 'M-Net CN',
    region: 'cn'
  })
  if (compatibility.kind !== 'migration_required') {
    throw new Error('expected legacy compatibility result for m-net-cn@0.1.0 fixture')
  }
  return {
    profileVersion: 'm-net-cn@0.1.0',
    region: 'cn',
    displayName: 'M-Net CN',
    schemaVersion: 'mnet-profile@0.1.0',
    status: 'available',
    rules: {
      mainlandNodeWithoutPublicAccess: { interconnect: 'tcp_required' }
    },
    capabilities: {
      controlPlaneOnly: true,
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false
    }
  }
}

function buildNetwork(overrides?: Partial<MigrationNetworkState>): MigrationNetworkState {
  return {
    networkId: 'net-cn-golden-001',
    profileVersion: 'm-net-cn@0.1.0',
    status: 'enabled',
    activeBreakGlass: false,
    operationStatus: 'idle',
    ...overrides
  }
}

function buildMigrationInput(
  profile: MigrationProfileCandidate,
  overrides?: Partial<MigrationInput>
): MigrationInput {
  return {
    profile,
    network: buildNetwork(),
    operationId: 'op-mnet-profile-migration-001',
    actor: 'system',
    reason: 'contract auto-migration to data-plane profile',
    ...overrides
  }
}

function effectKeys(effects: readonly PlannedMigrationEffect[]): readonly string[] {
  return effects.map(effect => effect.key)
}

function expectNoDuplicateEffects(effects: readonly PlannedMigrationEffect[]) {
  const keys = effectKeys(effects)
  expect(new Set(keys).size).toBe(keys.length)
}

describe('M-Net profile migration contract', () => {
  it('migrates the real m-net-cn@0.1.x profile fixture to m-net-cn@0.3.0 data-plane defaults', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()

    const result = module.migrateMNetProfile(buildMigrationInput(legacyProfile))

    if (result.kind !== 'migrated') throw new Error(`expected migrated, got ${result.kind}`)
    expect(result.profile.profileVersion).toBe('m-net-cn@0.3.0')
    expect(result.profile.schemaVersion).toBe('mnet-profile@0.3.0')
    expect(result.profile.capabilities.controlPlaneOnly).toBe(false)
    expect(result.profile.capabilities.realNetBirdSidecar).toBe(true)
    expect(result.profile.capabilities.signalConfigRef).toEqual({ configRef: 'signal/cn-primary' })
    if (result.profile.profileVersion !== 'm-net-cn@0.3.0') {
      throw new Error(`expected m-net-cn@0.3.0, got ${result.profile.profileVersion}`)
    }
    expect(result.profile.forcedTcpRelaySelector.routeClass).toBe('forced-tcp-relay')
    expect(result.network.profileVersion).toBe('m-net-cn@0.3.0')
    expect(result.network.desiredDataPlane).toEqual({
      networkMapStatus: 'planned',
      tunnelStatus: 'desired',
      relayFallback: 'desired'
    })
    expect(result.plannedEffects.map(effect => effect.kind)).toContain(
      'provision-data-plane-desired-state'
    )
    expect(result.audit).toEqual({
      action: 'mnet.profile.migration.plan',
      operationId: 'op-mnet-profile-migration-001',
      requiresAudit: true
    })
    expectNoDuplicateEffects(result.plannedEffects)
    expect(Schema.decodeUnknownSync(MNetRegionalProfileSchema)(result.profile)).toEqual(
      result.profile
    )
  })

  it('is idempotent and never plans duplicate data-plane effects', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()
    const input = buildMigrationInput(legacyProfile)

    const first = module.migrateMNetProfile(input)
    const repeated = module.migrateMNetProfile(input)

    expect(repeated).toEqual(first)
    if (first.kind !== 'migrated') throw new Error(`expected migrated, got ${first.kind}`)
    expectNoDuplicateEffects(first.plannedEffects)

    const second = module.migrateMNetProfile(
      buildMigrationInput(first.profile, { network: first.network })
    )
    if (second.kind !== 'already-migrated') {
      throw new Error(`expected already-migrated, got ${second.kind}`)
    }
    expect(second.profile).toEqual(first.profile)
    expect(second.network).toEqual(first.network)
    expect(second.plannedEffects).toEqual([])
  })

  it('rolls back a migrated profile to control-plane desired state and preserves audit history', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()
    const migrated = module.migrateMNetProfile(buildMigrationInput(legacyProfile))
    if (migrated.kind !== 'migrated') throw new Error(`expected migrated, got ${migrated.kind}`)

    const rollback = module.rollbackMNetProfile({
      currentProfile: migrated.profile,
      currentNetwork: migrated.network,
      targetControlPlaneProfile: legacyProfile,
      operationId: 'op-mnet-profile-migration-001',
      actor: 'operator',
      reason: 'operator requested rollback before network-map apply',
      appliedNetworkMap: false,
      rotatedNodeKeys: [],
      auditTrail: [
        {
          auditId: 'audit-original-migration',
          action: 'mnet.profile.migration.plan',
          recordedAt: '2026-06-18T00:00:00.000Z'
        }
      ]
    })

    if (rollback.kind !== 'rolled-back')
      throw new Error(`expected rolled-back, got ${rollback.kind}`)
    expect(rollback.profile.profileVersion).toBe('m-net-cn@0.1.0')
    expect(rollback.profile.capabilities.controlPlaneOnly).toBe(true)
    expect(rollback.network.profileVersion).toBe('m-net-cn@0.1.0')
    expect(rollback.network.status).toBe('disabled')
    expect('desiredDataPlane' in rollback.network).toBe(false)
    expect(rollback.plannedEffects.map(effect => effect.kind)).toEqual([
      'set-network-profile',
      'tear-down-data-plane-desired-state',
      'preserve-audit-history',
      'write-audit-fact'
    ])
    expect(rollback.audit.preservedAuditIds).toEqual(['audit-original-migration'])
    expectNoDuplicateEffects(rollback.plannedEffects)
  })

  it('returns typed irreversible rollback with audit metadata after applied network map or key rotation', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()
    const migrated = module.migrateMNetProfile(buildMigrationInput(legacyProfile))
    if (migrated.kind !== 'migrated') throw new Error(`expected migrated, got ${migrated.kind}`)

    const rollback = module.rollbackMNetProfile({
      currentProfile: migrated.profile,
      currentNetwork: migrated.network,
      targetControlPlaneProfile: legacyProfile,
      operationId: 'op-mnet-profile-migration-001',
      actor: 'operator',
      reason: 'operator requested rollback after data-plane apply',
      appliedNetworkMap: true,
      rotatedNodeKeys: ['node-cn-1'],
      auditTrail: [
        {
          auditId: 'audit-network-map-applied',
          action: 'mnet.network_map.published.v0',
          recordedAt: '2026-06-18T00:05:00.000Z'
        }
      ]
    })

    if (rollback.kind !== 'irreversible')
      throw new Error(`expected irreversible, got ${rollback.kind}`)
    expect(rollback.reasonCodes).toEqual([
      'network_map_already_applied',
      'node_keys_already_rotated'
    ])
    expect(rollback.auditRequired.action).toBe('mnet.profile.migration.rollback.irreversible')
    expect(rollback.auditRequired.operationId).toBe('op-mnet-profile-migration-001')
    expect(rollback.auditRequired.metadata).toEqual({
      networkId: 'net-cn-golden-001',
      appliedNetworkMap: true,
      rotatedNodeKeys: ['node-cn-1'],
      preservedAuditIds: ['audit-network-map-applied']
    })
  })

  it('marks networks with active break-glass or in-progress operations as not eligible', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()

    const result = module.checkMigrationEligibility({
      profile: legacyProfile,
      network: buildNetwork({
        activeBreakGlass: true,
        operationStatus: 'in_progress'
      })
    })

    if (result.kind !== 'not-eligible') throw new Error(`expected not-eligible, got ${result.kind}`)
    expect(result.reasons).toEqual(['active_break_glass', 'operation_in_progress'])
    expect(result.auditRequired).toEqual({
      action: 'mnet.profile.migration.not_eligible',
      metadata: {
        networkId: 'net-cn-golden-001',
        profileVersion: 'm-net-cn@0.1.0',
        reasons: ['active_break_glass', 'operation_in_progress']
      }
    })
  })

  it('rejects unknown profile versions with typed error metadata', async () => {
    const module = await loadMigrationModule()
    const legacyProfile = await loadGoldenLegacyProfile()
    const unknownProfile: MigrationProfileCandidate = {
      ...legacyProfile,
      profileVersion: 'm-net-cn@9.9.9',
      schemaVersion: 'mnet-profile@9.9.9'
    }

    const result = module.migrateMNetProfile(buildMigrationInput(unknownProfile))

    if (result.kind !== 'unsupported-version') {
      throw new Error(`expected unsupported-version, got ${result.kind}`)
    }
    expect(result.error).toEqual({
      code: 'profile.version_unsupported',
      profileVersion: 'm-net-cn@9.9.9',
      supportedSourceVersions: ['m-net-cn@0.1.0', 'm-net-cn@0.3.0']
    })
  })
})
