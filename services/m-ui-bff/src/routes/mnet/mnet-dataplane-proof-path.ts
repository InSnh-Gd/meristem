import type {
  BffOperationalProofPathResponseFromSchema,
  MNetOperationalSnapshotFromSchema,
  Permission,
  PolicyDecisionFromSchema
} from '../../../../../packages/contracts/src/index.ts'
import { aggregateRuntimeTruth } from './mnet-proof-path-runtime-support.ts'

const operationalStateSource = (networkId: string, suffix: string) => ({
  sourceType: 'read-model' as const,
  sourceId: `mnet:/api/v0/networks/${networkId}/operational-state#${suffix}`
})

/** 将公开 operational snapshot 适配成 proof-path 读模型，不在 BFF 内合成授权或最终状态。 */
export function mapOperationalSnapshotToProofPath(
  snapshot: MNetOperationalSnapshotFromSchema,
  permissions: readonly Permission[],
  policyDecision?: PolicyDecisionFromSchema
): BffOperationalProofPathResponseFromSchema {
  const migration =
    snapshot.migrationRequired.required && snapshot.migrationRequired.migration
      ? {
          code: 'migration_required' as const,
          message: snapshot.migrationRequired.summary,
          migration: snapshot.migrationRequired.migration
        }
      : undefined
  const missingEnable = permissions.includes('network:profile-enable')
    ? undefined
    : {
        code: 'missing_permission' as const,
        message: '缺少权限：network:profile-enable',
        missingPermission: 'network:profile-enable' as const
      }
  const profileSelectionReason = migration ?? missingEnable
  const breakGlassEnabled = permissions.includes('network:profile-disable')
  return {
    networkId: snapshot.networkId,
    createManageStatus: {
      mode: 'manage',
      networkId: snapshot.networkId,
      networkStatus: snapshot.network.status,
      profileState: snapshot.network.profileState,
      memberCount: snapshot.network.memberCount,
      lastUpdatedAt: snapshot.network.lastUpdatedAt,
      summary: snapshot.network.summary,
      stateSource: operationalStateSource(snapshot.networkId, 'network')
    },
    profileSelection: {
      networkId: snapshot.networkId,
      profileSelection: snapshot.profileSelection,
      summary: snapshot.profileSelection.migration?.message ?? snapshot.network.summary,
      ...(profileSelectionReason ? { disabledReason: profileSelectionReason } : {}),
      stateSource: operationalStateSource(snapshot.networkId, 'profileSelection')
    },
    topology: {
      networkId: snapshot.networkId,
      topology: snapshot.topology,
      stateSource: operationalStateSource(snapshot.networkId, 'topology')
    },
    sidecarHealth: {
      networkId: snapshot.networkId,
      status: snapshot.sidecars.some(node => node.healthStatus === 'unhealthy' || node.stale)
        ? 'degraded'
        : snapshot.sidecars.length > 0
          ? 'healthy'
          : 'blocked',
      summary:
        snapshot.sidecars.length === 0
          ? 'No sidecar health facts are available'
          : `${snapshot.sidecars.length} sidecar runtime entries are visible`,
      nodes: snapshot.sidecars,
      stateSource: operationalStateSource(snapshot.networkId, 'sidecars')
    },
    credentialLifecycle: {
      networkId: snapshot.networkId,
      credentials: snapshot.credentials,
      stateSource: operationalStateSource(snapshot.networkId, 'credentials')
    },
    migration: {
      networkId: snapshot.networkId,
      migration: snapshot.migrationRequired,
      ...(migration ? { disabledReason: migration } : {}),
      stateSource: operationalStateSource(snapshot.networkId, 'migration')
    },
    policyEligibility: {
      networkId: snapshot.networkId,
      commands: [
        {
          commandId: 'network.profile.enable.execute',
          label: '切换网络 Profile',
          action: 'network:profile-enable',
          resource: `network:${snapshot.networkId}`,
          requiredPermissions: ['network:profile-enable'],
          requiresPolicy: true,
          requiresAudit: true,
          state: profileSelectionReason ? 'disabled' : 'enabled',
          ...(profileSelectionReason ? { disabledReason: profileSelectionReason } : {}),
          summary: profileSelectionReason?.message ?? '公开事实允许发起 profile 管理请求'
        },
        {
          commandId: 'network.break-glass.execute',
          label: '执行 break-glass',
          action: 'network:profile-disable',
          resource: `network:${snapshot.networkId}`,
          requiredPermissions: ['network:profile-disable'],
          requiresPolicy: true,
          requiresAudit: true,
          state: breakGlassEnabled ? 'enabled' : 'disabled',
          ...(!breakGlassEnabled
            ? {
                disabledReason: {
                  code: 'missing_permission' as const,
                  message: '缺少权限：network:profile-disable',
                  missingPermission: 'network:profile-disable' as const
                }
              }
            : {}),
          summary: 'BFF 只展示策略资格，不决定最终授权'
        }
      ],
      stateSource: operationalStateSource(snapshot.networkId, 'policyEligibility')
    },
    progressFeed: {
      networkId: snapshot.networkId,
      eventStream: snapshot.eventStream,
      deploymentReadiness: snapshot.deploymentReadiness,
      summary: snapshot.deploymentReadiness.summary,
      stateSource: operationalStateSource(snapshot.networkId, 'progressFeed')
    },
    runtimeTruth: aggregateRuntimeTruth({
      snapshot,
      permissions,
      ...(policyDecision ? { policyDecision } : {})
    })
  }
}
