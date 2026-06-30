import type { NetworkProfileMigrationResult } from './global-defaults-store.ts'
import { migrationResult } from './migration-engine-helpers.ts'
import {
  getStoredMigration,
  type MigrationEngineDeps,
  storeMigration
} from './migration-engine-pure.ts'
import {
  rollbackMNetProfile,
  type MigrationProfileCandidate,
  type MigrationNetworkState
} from './profile-migration.ts'

function toRollbackProfileCandidate(profileVersion: string): MigrationProfileCandidate {
  if (profileVersion === 'm-net-cn@0.3.0') {
    return {
      profileVersion: 'm-net-cn@0.3.0',
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
    profileVersion,
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

function toRollbackNetworkState(
  networkId: string,
  state: { profileVersion: string; status: string },
  migrationStatus?: string
): MigrationNetworkState {
  return {
    networkId,
    profileVersion: state.profileVersion,
    status: state.status === 'disabled' || state.status === 'enabled' ? state.status : 'enabled',
    activeBreakGlass: false,
    operationStatus: 'idle',
    ...(migrationStatus === 'pending' || migrationStatus === 'applied'
      ? {
          desiredDataPlane: {
            networkMapStatus: 'planned',
            tunnelStatus: 'desired',
            relayFallback: 'desired'
          }
        }
      : {})
  }
}

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
  const timestamp = new Date().toISOString()
  const state = await deps.profileStore.getNetworkState(input.networkId)
  const previousProfileVersion = input.snapshot.get(input.networkId) ?? LEGACY_CN_PROFILE_VERSION
  if (!state) {
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
    currentProfile: toRollbackProfileCandidate(state.profileVersion),
    currentNetwork: toRollbackNetworkState(input.networkId, state, migration?.status),
    targetControlPlaneProfile: toRollbackProfileCandidate(previousProfileVersion),
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
    timestamp,
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
