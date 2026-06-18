import type { NetworkProfileMigrationResult } from './global-defaults-store.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { ProfileStore } from './profile-store.ts'
import type { GlobalDefaultsStore } from './global-defaults-store.ts'
import { rollbackMNetProfile, type MigrationProfileCandidate } from './profile-migration.ts'
import {
  getStoredMigration,
  storeMigration,
  type MigrationEngineDeps
} from './migration-engine-pure.ts'
import { migrationResult, type NetworkSnapshot } from './migration-engine-helpers.ts'

export async function rollbackNetwork(
  deps: MigrationEngineDeps,
  input: {
    operationId: string
    operation: { targetProfileVersion: string }
    networkId: string
    actor: string
    reason?: string
    snapshot: Map<string, string>
  }
): Promise<NetworkProfileMigrationResult> {
  const correlationId = crypto.randomUUID()
  const state = await deps.profileStore.getNetworkState(input.networkId)
  const previousProfileVersion = input.snapshot.get(input.networkId) ?? LEGACY_CN_PROFILE_VERSION
  const currentProfile = state ? await deps.profileStore.getDefinition(state.profileVersion) : null
  const previousProfile = await deps.profileStore.getDefinition(previousProfileVersion)
  if (!state || !currentProfile || !previousProfile) {
    return migrationResult(
      input.networkId,
      input.operation.targetProfileVersion,
      previousProfileVersion,
      'failed',
      {
        correlationId,
        reason: 'rollback profile definition missing'
      }
    )
  }
  const migration = await getStoredMigration(deps, input.networkId, input.operationId)
  const rollback = rollbackMNetProfile({
    currentProfile,
    currentNetwork: {
      networkId: input.networkId,
      profileVersion: state.profileVersion,
      status: state.status === 'disabled' || state.status === 'enabled' ? state.status : 'enabled',
      activeBreakGlass: false,
      operationStatus: 'idle',
      ...(migration?.status === 'pending' || migration?.status === 'applied'
        ? {
            desiredDataPlane: {
              networkMapStatus: 'planned',
              tunnelStatus: 'desired',
              relayFallback: 'desired'
            }
          }
        : {})
    },
    targetControlPlaneProfile: previousProfile,
    operationId: input.operationId,
    actor: input.actor,
    reason: input.reason ?? 'batch migration rollback',
    appliedNetworkMap: false,
    rotatedNodeKeys: [],
    auditTrail: migration?.auditMetadata?.auditId
      ? [
          {
            auditId: String(migration.auditMetadata.auditId),
            action: 'mnet.profile.migration.plan',
            recordedAt: migration.startedAt
          }
        ]
      : []
  })
  if (rollback.kind === 'irreversible') {
    await deps.writeAudit({
      actor: input.actor,
      action: rollback.auditRequired.action,
      resource: `network:${input.networkId}`,
      result: 'failure',
      correlationId,
      metadata: rollback.auditRequired.metadata
    })
    return migrationResult(
      input.networkId,
      input.operation.targetProfileVersion,
      previousProfileVersion,
      'failed',
      {
        correlationId,
        reason: rollback.reasonCodes.join(',')
      }
    )
  }
  await deps.profileStore.setNetworkState(input.networkId, {
    profileVersion: rollback.profile.profileVersion,
    status: rollback.network.status
  })
  await deps.profileStore.recordTransition({
    networkId: input.networkId,
    fromVersion: state.profileVersion,
    toVersion: rollback.profile.profileVersion,
    fromStatus: state.status,
    toStatus: rollback.network.status,
    actor: input.actor,
    reason: input.reason ?? 'batch migration rollback',
    correlationId
  })
  const auditId =
    (await deps.writeAudit({
      actor: input.actor,
      action: rollback.audit.action,
      resource: `network:${input.networkId}`,
      result: 'rolled_back',
      correlationId,
      metadata: {
        operationId: input.operationId,
        preservedAuditIds: rollback.audit.preservedAuditIds
      }
    })) ?? correlationId
  await storeMigration(deps, {
    networkId: input.networkId,
    fromVersion: input.operation.targetProfileVersion,
    toVersion: previousProfileVersion,
    operationId: input.operationId,
    status: 'rolled_back',
    timestamp: correlationId,
    auditMetadata: { auditId, reason: input.reason ?? 'batch migration rollback' }
  })
  return migrationResult(
    input.networkId,
    input.operation.targetProfileVersion,
    previousProfileVersion,
    'rolled_back',
    {
      correlationId,
      auditId
    }
  )
}

const LEGACY_CN_PROFILE_VERSION = 'm-net-cn@0.1.0'
