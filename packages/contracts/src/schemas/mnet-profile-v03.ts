import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import { RedactedSecretRefSchema, SecretRefSchema } from './secret-provider.ts'

export const MNetProfileV03VersionSchema = Schema.Literal('m-net@0.3.0', 'm-net-cn@0.3.0')
export type MNetProfileV03VersionFromSchema = typeof MNetProfileV03VersionSchema.Type

export const MNetProfileV03SchemaVersionSchema = Schema.Literal('mnet-profile@0.3.0')
export type MNetProfileV03SchemaVersionFromSchema = typeof MNetProfileV03SchemaVersionSchema.Type

export const MNetInfrastructureConfigRefSchema = Schema.Struct({
  configRef: Schema.String
})
export type MNetInfrastructureConfigRefFromSchema = typeof MNetInfrastructureConfigRefSchema.Type

export const MNetSidecarDesiredStateSchema = Schema.Literal(
  'install',
  'configure',
  'start',
  'drain',
  'stop'
)
export type MNetSidecarDesiredStateFromSchema = typeof MNetSidecarDesiredStateSchema.Type

export const MNetSidecarCredentialStatusSchema = Schema.Literal(
  'missing',
  'pending',
  'ready',
  'expired',
  'rotation_required'
)
export type MNetSidecarCredentialStatusFromSchema = typeof MNetSidecarCredentialStatusSchema.Type

export const MNetSidecarHealthStatusSchema = Schema.Literal(
  'unknown',
  'healthy',
  'degraded',
  'unhealthy'
)
export type MNetSidecarHealthStatusFromSchema = typeof MNetSidecarHealthStatusSchema.Type

export const MNetNetBirdDataPlaneCapabilitiesSchema = Schema.Struct({
  controlPlaneOnly: Schema.Literal(false),
  managementPlaneExcluded: Schema.Literal(true),
  realNetBirdSidecar: Schema.Literal(true),
  signalConfigRef: MNetInfrastructureConfigRefSchema,
  relayConfigRef: MNetInfrastructureConfigRefSchema,
  stunConfigRef: MNetInfrastructureConfigRefSchema,
  sidecarDesiredState: MNetSidecarDesiredStateSchema,
  sidecarCredentialRef: SecretRefSchema,
  sidecarCredentialStatus: MNetSidecarCredentialStatusSchema,
  sidecarHealthStatus: MNetSidecarHealthStatusSchema
})
export type MNetNetBirdDataPlaneCapabilitiesFromSchema =
  typeof MNetNetBirdDataPlaneCapabilitiesSchema.Type

export const MNetRouteClassSchema = Schema.Literal('standard', 'cn-resident', 'forced-tcp-relay')
export type MNetRouteClassFromSchema = typeof MNetRouteClassSchema.Type

export const MNetSelectorOwnershipSchema = Schema.Literal('operator', 'policy')
export type MNetSelectorOwnershipFromSchema = typeof MNetSelectorOwnershipSchema.Type

export const MNetNodeSelectorSchema = Schema.Union(
  Schema.Struct({
    selectorType: Schema.Literal('all-leaf-nodes'),
    includeAllLeafNodes: Schema.Literal(true)
  }),
  Schema.Struct({
    selectorType: Schema.Literal('node-ids'),
    nodeIds: Schema.Array(Schema.String)
  }),
  Schema.Struct({
    selectorType: Schema.Literal('label-selector'),
    matchLabels: Schema.Record({ key: Schema.String, value: Schema.String })
  })
)
export type MNetNodeSelectorFromSchema = typeof MNetNodeSelectorSchema.Type

export const MNetPolicyDecisionRefSchema = Schema.Struct({
  decisionId: Schema.String,
  source: Schema.Literal('m-policy'),
  outcome: Schema.Literal('allow', 'deny', 'conditional'),
  reason: Schema.String
})
export type MNetPolicyDecisionRefFromSchema = typeof MNetPolicyDecisionRefSchema.Type

export const MNetAuditEvidenceSchema = Schema.Struct({
  auditId: Schema.String,
  eventId: Schema.String,
  eventSubject: Schema.Literal('mnet.forced_relay.change.v0')
})
export type MNetAuditEvidenceFromSchema = typeof MNetAuditEvidenceSchema.Type

export const MNetForcedTcpRelaySelectorSchema = Schema.Struct({
  enabled: Schema.Literal(true),
  selectorOwnership: MNetSelectorOwnershipSchema,
  selector: MNetNodeSelectorSchema,
  routeClass: MNetRouteClassSchema,
  operatorOverrideAllowed: Schema.Boolean,
  operatorOverrideActive: Schema.Boolean,
  operatorOverrideActor: Schema.optional(Schema.Literal(...actorIds)),
  operatorOverrideReason: Schema.optional(Schema.String),
  policyDecision: MNetPolicyDecisionRefSchema,
  auditEvidence: MNetAuditEvidenceSchema
})
export type MNetForcedTcpRelaySelectorFromSchema = typeof MNetForcedTcpRelaySelectorSchema.Type

const MNetDefaultProfileV03BaseSchema = Schema.Struct({
  profileVersion: Schema.Literal('m-net@0.3.0'),
  region: Schema.Literal('default'),
  displayName: Schema.String,
  schemaVersion: MNetProfileV03SchemaVersionSchema,
  status: Schema.Literal('available', 'deprecated'),
  rules: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  capabilities: MNetNetBirdDataPlaneCapabilitiesSchema
})

export const MNetProfileV03Schema = MNetDefaultProfileV03BaseSchema
export type MNetProfileV03FromSchema = typeof MNetProfileV03Schema.Type

export const MNetCnProfileV03Schema = Schema.Struct({
  profileVersion: Schema.Literal('m-net-cn@0.3.0'),
  region: Schema.Literal('cn'),
  displayName: Schema.String,
  schemaVersion: MNetProfileV03SchemaVersionSchema,
  status: Schema.Literal('available', 'deprecated'),
  rules: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  capabilities: MNetNetBirdDataPlaneCapabilitiesSchema,
  forcedTcpRelaySelector: MNetForcedTcpRelaySelectorSchema
})
export type MNetCnProfileV03FromSchema = typeof MNetCnProfileV03Schema.Type

export const MNetRegionalProfileV03Schema = Schema.Union(
  MNetProfileV03Schema,
  MNetCnProfileV03Schema
)
export type MNetRegionalProfileV03FromSchema = typeof MNetRegionalProfileV03Schema.Type

export const MNetMigrationRequiredReasonCodeSchema = Schema.Literal(
  'legacy_profile_v0_1',
  'legacy_cn_profile_v0_1',
  'legacy_wstunnel_profile_v0_2',
  'legacy_wstunnel_node'
)
export type MNetMigrationRequiredReasonCodeFromSchema =
  typeof MNetMigrationRequiredReasonCodeSchema.Type

export const MNetMigrationRequiredGuidanceKeySchema = Schema.Literal(
  'rebuild_node_with_netbird_sidecar',
  'migrate_profile_to_mnet_v03',
  'migrate_profile_to_mnet_cn_v03'
)
export type MNetMigrationRequiredGuidanceKeyFromSchema =
  typeof MNetMigrationRequiredGuidanceKeySchema.Type

export const MNetMigrationRequiredSchema = Schema.Struct({
  code: Schema.Literal('migration_required'),
  message: Schema.String,
  targetProfileVersion: MNetProfileV03VersionSchema,
  rebuildGuidanceKey: MNetMigrationRequiredGuidanceKeySchema,
  affectedProfileIds: Schema.Array(Schema.String),
  affectedNodeIds: Schema.Array(Schema.String),
  reasonCode: MNetMigrationRequiredReasonCodeSchema
})
export type MNetMigrationRequiredFromSchema = typeof MNetMigrationRequiredSchema.Type

export const MNetMigrationRequiredErrorSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Literal('migration_required'),
    message: Schema.String,
    correlationId: Schema.optional(Schema.String),
    migration: MNetMigrationRequiredSchema
  })
})
export type MNetMigrationRequiredErrorFromSchema = typeof MNetMigrationRequiredErrorSchema.Type

export const MNetMigrationRequiredCliOutputSchema = Schema.Struct({
  status: Schema.Literal('migration_required'),
  migration: MNetMigrationRequiredSchema
})
export type MNetMigrationRequiredCliOutputFromSchema =
  typeof MNetMigrationRequiredCliOutputSchema.Type

export const MNetMigrationReportItemSchema = Schema.Struct({
  resourceKind: Schema.Literal('profile', 'node'),
  resourceId: Schema.String,
  migration: MNetMigrationRequiredSchema
})
export type MNetMigrationReportItemFromSchema = typeof MNetMigrationReportItemSchema.Type

export const MNetMigrationReportSchema = Schema.Struct({
  status: Schema.Literal('ok', 'migration_required'),
  generatedAt: Schema.String,
  items: Schema.Array(MNetMigrationReportItemSchema)
})
export type MNetMigrationReportFromSchema = typeof MNetMigrationReportSchema.Type

export const MNetMigrationRequiredDisabledReasonSchema = Schema.Struct({
  disabledReason: Schema.Literal('migration_required'),
  migration: MNetMigrationRequiredSchema
})
export type MNetMigrationRequiredDisabledReasonFromSchema =
  typeof MNetMigrationRequiredDisabledReasonSchema.Type

export const MNetNodeRuntimeProfileSchema = Schema.Struct({
  nodeId: Schema.String,
  profileVersion: Schema.String,
  transport: Schema.Literal('netbird-sidecar', 'wstunnel', 'wireguard-rendered')
})
export type MNetNodeRuntimeProfileFromSchema = typeof MNetNodeRuntimeProfileSchema.Type

export const MNetProfileV03CompatibilityResultSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('profile'), profile: MNetRegionalProfileV03Schema }),
  Schema.Struct({
    kind: Schema.Literal('migration_required'),
    migration: MNetMigrationRequiredSchema
  })
)
export type MNetProfileV03CompatibilityResultFromSchema =
  typeof MNetProfileV03CompatibilityResultSchema.Type

export const MNetNodeV03CompatibilityResultSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('node-ready'), node: MNetNodeRuntimeProfileSchema }),
  Schema.Struct({
    kind: Schema.Literal('migration_required'),
    migration: MNetMigrationRequiredSchema
  })
)
export type MNetNodeV03CompatibilityResultFromSchema =
  typeof MNetNodeV03CompatibilityResultSchema.Type

export const MNetProfileV03EventSubjectSchema = Schema.Literal(
  'mnet.sidecar.lifecycle.v0',
  'mnet.sidecar.health.v0',
  'mnet.topology.update.v0',
  'mnet.migration.required.v0',
  'mnet.forced_relay.change.v0',
  'mnet.credential.expiry.v0'
)
export type MNetProfileV03EventSubjectFromSchema = typeof MNetProfileV03EventSubjectSchema.Type

export const MNetSidecarLifecycleEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  previousDesiredState: MNetSidecarDesiredStateSchema,
  desiredState: MNetSidecarDesiredStateSchema,
  credentialStatus: MNetSidecarCredentialStatusSchema,
  signalConfigRef: MNetInfrastructureConfigRefSchema,
  relayConfigRef: MNetInfrastructureConfigRefSchema,
  stunConfigRef: MNetInfrastructureConfigRefSchema,
  correlationId: Schema.String,
  auditId: Schema.String
})
export type MNetSidecarLifecycleEventPayloadFromSchema =
  typeof MNetSidecarLifecycleEventPayloadSchema.Type

export const MNetSidecarHealthEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  healthStatus: MNetSidecarHealthStatusSchema,
  previousHealthStatus: MNetSidecarHealthStatusSchema,
  signalReachable: Schema.Boolean,
  relayReachable: Schema.Boolean,
  stunReachable: Schema.Boolean,
  checkedAt: Schema.String,
  correlationId: Schema.String
})
export type MNetSidecarHealthEventPayloadFromSchema =
  typeof MNetSidecarHealthEventPayloadSchema.Type

export const MNetTopologyUpdateEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  topologyRevision: Schema.String,
  routeClass: MNetRouteClassSchema,
  sidecarDesiredState: MNetSidecarDesiredStateSchema,
  affectedNodeIds: Schema.Array(Schema.String),
  policyDecisionId: Schema.String,
  auditId: Schema.String,
  correlationId: Schema.String
})
export type MNetTopologyUpdateEventPayloadFromSchema =
  typeof MNetTopologyUpdateEventPayloadSchema.Type

export const MNetMigrationRequiredEventPayloadSchema = Schema.Struct({
  resourceKind: Schema.Literal('profile', 'node'),
  networkId: Schema.optional(Schema.String),
  policyDecisionId: Schema.optional(Schema.String),
  auditId: Schema.String,
  correlationId: Schema.String,
  migration: MNetMigrationRequiredSchema
})
export type MNetMigrationRequiredEventPayloadFromSchema =
  typeof MNetMigrationRequiredEventPayloadSchema.Type

export const MNetForcedRelayChangeEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  profileVersion: Schema.Literal('m-net-cn@0.3.0'),
  routeClass: MNetRouteClassSchema,
  selectorOwnership: MNetSelectorOwnershipSchema,
  selector: MNetNodeSelectorSchema,
  operatorOverrideActive: Schema.Boolean,
  policyDecisionId: Schema.String,
  auditId: Schema.String,
  eventId: Schema.String,
  affectedNodeIds: Schema.Array(Schema.String),
  correlationId: Schema.String
})
export type MNetForcedRelayChangeEventPayloadFromSchema =
  typeof MNetForcedRelayChangeEventPayloadSchema.Type

export const MNetCredentialExpiryEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  credentialRef: RedactedSecretRefSchema,
  credentialStatus: MNetSidecarCredentialStatusSchema,
  expiresAt: Schema.String,
  correlationId: Schema.String,
  auditId: Schema.String
})
export type MNetCredentialExpiryEventPayloadFromSchema =
  typeof MNetCredentialExpiryEventPayloadSchema.Type

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
