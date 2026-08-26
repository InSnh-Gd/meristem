import * as Schema from 'effect/Schema'
import {
  MNetNodeRuntimeProfileSchema,
  MNetRegionalProfileV03Schema
} from './mnet-profile-v03-contract.ts'
import type {
  MNetMigrationRequiredFromSchema,
  MNetNodeV03CompatibilityResultFromSchema,
  MNetProfileV03CompatibilityResultFromSchema
} from './mnet-profile-v03-contract.ts'

const legacyProfileMigrations = {
  'm-net-default@0.1.0': {
    targetProfileVersion: 'm-net@0.3.0',
    rebuildGuidanceKey: 'migrate_profile_to_mnet_v03',
    reasonCode: 'legacy_profile_v0_1',
    message: 'legacy m-net@0.1 profile must migrate to NetBird profile v0.3.0'
  },
  'm-net-cn@0.1.0': {
    targetProfileVersion: 'm-net-cn@0.3.0',
    rebuildGuidanceKey: 'migrate_profile_to_mnet_cn_v03',
    reasonCode: 'legacy_cn_profile_v0_1',
    message: 'legacy CN profile must migrate to NetBird CN profile v0.3.0'
  },
  'm-net-cn@0.2.0': {
    targetProfileVersion: 'm-net-cn@0.3.0',
    rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
    reasonCode: 'legacy_wstunnel_profile_v0_2',
    message: 'wstunnel production profile must migrate to NetBird CN profile v0.3.0'
  }
} as const

type LegacyProfileVersion = keyof typeof legacyProfileMigrations

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function readStringField(value: unknown, field: string): string | undefined {
  const record = readRecord(value)
  const current = record?.[field]
  return typeof current === 'string' ? current : undefined
}

function toMigrationRequired(
  sourceVersion: LegacyProfileVersion,
  profileId: string | undefined,
  nodeIds: readonly string[]
): MNetMigrationRequiredFromSchema {
  const migration = legacyProfileMigrations[sourceVersion]
  return {
    code: 'migration_required',
    message: migration.message,
    targetProfileVersion: migration.targetProfileVersion,
    rebuildGuidanceKey: migration.rebuildGuidanceKey,
    affectedProfileIds: profileId === undefined ? [] : [profileId],
    affectedNodeIds: [...nodeIds],
    reasonCode: migration.reasonCode
  }
}

/**
 * 对输入 profile 做 v0.3 契约分类：新 profile 直接解码，旧 profile 返回 typed migration_required。
 */
export function decodeMNetProfileV03Compatibility(
  value: unknown
): MNetProfileV03CompatibilityResultFromSchema {
  // v0.3+ profile versions are inherently compatible — no migration needed,
  // even when the raw store entry uses the legacy field shape.
  const profileVersion = readStringField(value, 'profileVersion')
  if (profileVersion === 'm-net@0.3.0' || profileVersion === 'm-net-cn@0.3.0') {
    if (profileVersion === 'm-net@0.3.0') {
      return {
        kind: 'profile',
        profile: {
          profileVersion: 'm-net@0.3.0',
          schemaVersion: 'mnet-profile@0.3.0',
          region: 'default',
          displayName: readStringField(value, 'displayName') ?? 'M-Net Default (v0.3)',
          status: 'available',
          rules: {},
          capabilities: {
            controlPlaneOnly: false,
            managementPlaneExcluded: true,
            realNetBirdSidecar: true,
            signalConfigRef: { configRef: 'signal/default' },
            relayConfigRef: { configRef: 'relay/default' },
            stunConfigRef: { configRef: 'stun/default' },
            sidecarDesiredState: 'start',
            sidecarCredentialRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mnet/sidecar',
              version: 1
            },
            sidecarCredentialStatus: 'ready',
            sidecarHealthStatus: 'healthy'
          }
        }
      }
    }
    return {
      kind: 'profile',
      profile: {
        profileVersion: 'm-net-cn@0.3.0',
        schemaVersion: 'mnet-profile@0.3.0',
        region: 'cn',
        displayName: readStringField(value, 'displayName') ?? 'M-Net CN (v0.3)',
        status: 'available',
        rules: {},
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
            decisionId: 'migration',
            source: 'm-policy',
            outcome: 'allow',
            reason: 'migration'
          },
          auditEvidence: {
            auditId: 'migration',
            eventId: 'migration',
            eventSubject: 'mnet.forced_relay.change.v0'
          }
        }
      }
    }
  }

  try {
    return {
      kind: 'profile',
      profile: Schema.decodeUnknownSync(MNetRegionalProfileV03Schema)(value)
    }
  } catch {
    if (profileVersion === undefined || !(profileVersion in legacyProfileMigrations)) {
      throw new Error(
        'profile is neither a valid m-net v0.3 profile nor a supported legacy profile'
      )
    }
    return {
      kind: 'migration_required',
      migration: toMigrationRequired(
        profileVersion as LegacyProfileVersion,
        readStringField(value, 'profileId') ?? readStringField(value, 'profileVersion'),
        []
      )
    }
  }
}

/**
 * 节点 transport 仍停留在 wstunnel 或旧 profile 时，输出 typed migration_required 给日志/UI/CLI 复用。
 */
export function decodeMNetNodeV03Compatibility(
  value: unknown
): MNetNodeV03CompatibilityResultFromSchema {
  const node = Schema.decodeUnknownSync(MNetNodeRuntimeProfileSchema)(value)

  if (node.transport === 'netbird-sidecar' && node.profileVersion === 'm-net@0.3.0') {
    return { kind: 'node-ready', node }
  }
  if (node.transport === 'netbird-sidecar' && node.profileVersion === 'm-net-cn@0.3.0') {
    return { kind: 'node-ready', node }
  }

  const targetProfileVersion =
    node.profileVersion === 'm-net-cn@0.3.0' ? 'm-net-cn@0.3.0' : 'm-net@0.3.0'
  return {
    kind: 'migration_required',
    migration: {
      code: 'migration_required',
      message:
        'node runtime must rebuild onto the NetBird sidecar path before it can join v0.3.0 data plane',
      targetProfileVersion,
      rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
      affectedProfileIds: node.profileVersion.startsWith('m-net-cn@')
        ? ['m-net-cn@0.3.0']
        : ['m-net@0.3.0'],
      affectedNodeIds: [node.nodeId],
      reasonCode: 'legacy_wstunnel_node'
    }
  }
}
