import * as Schema from 'effect/Schema'
import {
  MNetProfileV03VersionSchema,
  MNetRegionalProfileV03Schema
} from './mnet-profile-v03-profile.ts'

/**
 * M-Net v0.3 profile 契约 schema 的迁移与运行态组：
 * migration_required 家族、node runtime transport 以及 profile/node 兼容性判定结果。
 */

export const MNetMigrationRequiredReasonCodeSchema = Schema.Literals([
  'legacy_profile_v0_1',
  'legacy_cn_profile_v0_1',
  'legacy_wstunnel_profile_v0_2',
  'legacy_wstunnel_node'
])
export type MNetMigrationRequiredReasonCodeFromSchema =
  typeof MNetMigrationRequiredReasonCodeSchema.Type

export const MNetMigrationRequiredGuidanceKeySchema = Schema.Literals([
  'rebuild_node_with_netbird_sidecar',
  'migrate_profile_to_mnet_v03',
  'migrate_profile_to_mnet_cn_v03'
])
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
  resourceKind: Schema.Literals(['profile', 'node']),
  resourceId: Schema.String,
  migration: MNetMigrationRequiredSchema
})
export type MNetMigrationReportItemFromSchema = typeof MNetMigrationReportItemSchema.Type

export const MNetMigrationReportSchema = Schema.Struct({
  status: Schema.Literals(['ok', 'migration_required']),
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
  transport: Schema.Literals(['netbird-sidecar', 'wstunnel', 'wireguard-rendered'])
})
export type MNetNodeRuntimeProfileFromSchema = typeof MNetNodeRuntimeProfileSchema.Type

export const MNetProfileV03CompatibilityResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('profile'), profile: MNetRegionalProfileV03Schema }),
  Schema.Struct({
    kind: Schema.Literal('migration_required'),
    migration: MNetMigrationRequiredSchema
  })
])
export type MNetProfileV03CompatibilityResultFromSchema =
  typeof MNetProfileV03CompatibilityResultSchema.Type

export const MNetNodeV03CompatibilityResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('node-ready'), node: MNetNodeRuntimeProfileSchema }),
  Schema.Struct({
    kind: Schema.Literal('migration_required'),
    migration: MNetMigrationRequiredSchema
  })
])
export type MNetNodeV03CompatibilityResultFromSchema =
  typeof MNetNodeV03CompatibilityResultSchema.Type
