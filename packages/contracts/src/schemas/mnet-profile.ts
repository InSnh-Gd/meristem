import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'

export const MNetProfileVersionSchema = Schema.Literal('m-net-cn@0.1.0', 'm-net-default@0.1.0')
export type MNetProfileVersionFromSchema = typeof MNetProfileVersionSchema.Type

export const MNetProfileRegionSchema = Schema.Literal('cn', 'default')
export type MNetProfileRegionFromSchema = typeof MNetProfileRegionSchema.Type

export const MNetRegionalProfileSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  region: MNetProfileRegionSchema,
  displayName: Schema.String,
  schemaVersion: Schema.Literal('mnet-profile@0.1.0'),
  status: Schema.Literal('available', 'deprecated'),
  rules: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  capabilities: Schema.Struct({
    realDerpRelay: Schema.Literal(false),
    realTcpInterconnect: Schema.Literal(false),
    realUdpPathSwitching: Schema.Literal(false),
    controlPlaneOnly: Schema.Boolean
  })
})
export type MNetRegionalProfileFromSchema = typeof MNetRegionalProfileSchema.Type

export const SetNetworkProfileRequestSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  reason: Schema.String
})
export type SetNetworkProfileRequestFromSchema = typeof SetNetworkProfileRequestSchema.Type

export const NetworkProfileStateSchema = Schema.Literal('disabled', 'enabling', 'enabled', 'disabling', 'failed')
export type NetworkProfileStateFromSchema = typeof NetworkProfileStateSchema.Type

export const NetworkProfileSummarySchema = Schema.Struct({
  networkId: Schema.String,
  profileVersion: MNetProfileVersionSchema,
  status: NetworkProfileStateSchema,
  enabledBy: Schema.optional(Schema.Literal(...actorIds)),
  policyDecisionId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  appliedAt: Schema.optional(Schema.String),
  disabledAt: Schema.optional(Schema.String),
  lastError: Schema.optional(Schema.String),
  updatedAt: Schema.String
})
export type NetworkProfileSummaryFromSchema = typeof NetworkProfileSummarySchema.Type

export const NetworkSuspendedOperationStatusSchema = Schema.Literal('suspended', 'resumed', 'rejected', 'expired', 'resume_failed')
export type NetworkSuspendedOperationStatusFromSchema = typeof NetworkSuspendedOperationStatusSchema.Type

export const NetworkSuspendedOperationSchema = Schema.Struct({
  id: Schema.String,
  policyDecisionId: Schema.String,
  action: Schema.Literal('mnet.profile.enable'),
  networkId: Schema.String,
  fromProfileVersion: MNetProfileVersionSchema,
  toProfileVersion: MNetProfileVersionSchema,
  requestedBy: Schema.Literal(...actorIds),
  reason: Schema.String,
  correlationId: Schema.String,
  idempotencyKey: Schema.String,
  status: NetworkSuspendedOperationStatusSchema,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  resumedAt: Schema.optional(Schema.String),
  terminalReason: Schema.optional(Schema.String)
})
export type NetworkSuspendedOperationFromSchema = typeof NetworkSuspendedOperationSchema.Type

export const MNetProfileEventSubjectSchema = Schema.Literal(
  'mnet.profile.enable.requested.v0',
  'mnet.profile.enabled.v0',
  'mnet.profile.disable.requested.v0',
  'mnet.profile.disabled.v0',
  'mnet.profile.apply_failed.v0',
  'mnet.profile.enable.canceled.v0'
)
export type MNetProfileEventSubjectFromSchema = typeof MNetProfileEventSubjectSchema.Type

export const MNetProfileEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  fromProfileVersion: MNetProfileVersionSchema,
  toProfileVersion: MNetProfileVersionSchema,
  actor: Schema.Literal(...actorIds),
  policyDecisionId: Schema.String,
  approvalId: Schema.optional(Schema.String),
  operationId: Schema.optional(Schema.String),
  correlationId: Schema.String,
  reason: Schema.String,
  controlPlaneOnly: Schema.Literal(true)
})
export type MNetProfileEventPayloadFromSchema = typeof MNetProfileEventPayloadSchema.Type
