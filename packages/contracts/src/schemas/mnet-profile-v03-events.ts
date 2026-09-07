import * as Schema from 'effect/Schema'
import { MNetMigrationRequiredSchema } from './mnet-profile-v03-migration.ts'
import {
  MNetInfrastructureConfigRefSchema,
  MNetNodeSelectorSchema,
  MNetProfileV03VersionSchema,
  MNetRouteClassSchema,
  MNetSelectorOwnershipSchema,
  MNetSidecarCredentialStatusSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthStatusSchema
} from './mnet-profile-v03-profile.ts'
import { RedactedSecretRefSchema } from './secret-provider.ts'

/**
 * M-Net v0.3 profile 契约 schema 的事件组：v0.3 事件主题字面量与
 * sidecar 生命周期/健康、拓扑更新、migration_required、forced relay、凭证到期事件 payload。
 */

export const MNetProfileV03EventSubjectSchema = Schema.Literals([
  'mnet.sidecar.lifecycle.v0',
  'mnet.sidecar.health.v0',
  'mnet.topology.update.v0',
  'mnet.migration.required.v0',
  'mnet.forced_relay.change.v0',
  'mnet.credential.expiry.v0'
])
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
  resourceKind: Schema.Literals(['profile', 'node']),
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
