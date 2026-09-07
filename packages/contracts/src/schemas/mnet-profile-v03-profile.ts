import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import { SecretRefSchema } from './secret-provider.ts'

/**
 * M-Net v0.3 profile 契约 schema 的 profile 组：版本字面量、sidecar 能力、
 * forced-tcp-relay selector 以及 default/cn/regional profile 结构。
 */

export const MNetProfileV03VersionSchema = Schema.Literals(['m-net@0.3.0', 'm-net-cn@0.3.0'])
export type MNetProfileV03VersionFromSchema = typeof MNetProfileV03VersionSchema.Type

export const MNetProfileV03SchemaVersionSchema = Schema.Literal('mnet-profile@0.3.0')
export type MNetProfileV03SchemaVersionFromSchema = typeof MNetProfileV03SchemaVersionSchema.Type

export const MNetInfrastructureConfigRefSchema = Schema.Struct({
  configRef: Schema.String
})
export type MNetInfrastructureConfigRefFromSchema = typeof MNetInfrastructureConfigRefSchema.Type

export const MNetSidecarDesiredStateSchema = Schema.Literals([
  'install',
  'configure',
  'start',
  'drain',
  'stop'
])
export type MNetSidecarDesiredStateFromSchema = typeof MNetSidecarDesiredStateSchema.Type

export const MNetSidecarCredentialStatusSchema = Schema.Literals([
  'missing',
  'pending',
  'ready',
  'expired',
  'rotation_required'
])
export type MNetSidecarCredentialStatusFromSchema = typeof MNetSidecarCredentialStatusSchema.Type

export const MNetSidecarHealthStatusSchema = Schema.Literals([
  'unknown',
  'healthy',
  'degraded',
  'unhealthy'
])
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

export const MNetRouteClassSchema = Schema.Literals(['standard', 'cn-resident', 'forced-tcp-relay'])
export type MNetRouteClassFromSchema = typeof MNetRouteClassSchema.Type

export const MNetSelectorOwnershipSchema = Schema.Literals(['operator', 'policy'])
export type MNetSelectorOwnershipFromSchema = typeof MNetSelectorOwnershipSchema.Type

export const MNetNodeSelectorSchema = Schema.Union([
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
    matchLabels: Schema.Record(Schema.String, Schema.String)
  })
])
export type MNetNodeSelectorFromSchema = typeof MNetNodeSelectorSchema.Type

export const MNetPolicyDecisionRefSchema = Schema.Struct({
  decisionId: Schema.String,
  source: Schema.Literal('m-policy'),
  outcome: Schema.Literals(['allow', 'deny', 'conditional']),
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
  operatorOverrideActor: Schema.optional(Schema.Literals(actorIds)),
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
  status: Schema.Literals(['available', 'deprecated']),
  rules: Schema.Record(Schema.String, Schema.Unknown),
  capabilities: MNetNetBirdDataPlaneCapabilitiesSchema
})

export const MNetProfileV03Schema = MNetDefaultProfileV03BaseSchema
export type MNetProfileV03FromSchema = typeof MNetProfileV03Schema.Type

export const MNetCnProfileV03Schema = Schema.Struct({
  profileVersion: Schema.Literal('m-net-cn@0.3.0'),
  region: Schema.Literal('cn'),
  displayName: Schema.String,
  schemaVersion: MNetProfileV03SchemaVersionSchema,
  status: Schema.Literals(['available', 'deprecated']),
  rules: Schema.Record(Schema.String, Schema.Unknown),
  capabilities: MNetNetBirdDataPlaneCapabilitiesSchema,
  forcedTcpRelaySelector: MNetForcedTcpRelaySelectorSchema
})
export type MNetCnProfileV03FromSchema = typeof MNetCnProfileV03Schema.Type

export const MNetRegionalProfileV03Schema = Schema.Union([
  MNetProfileV03Schema,
  MNetCnProfileV03Schema
])
export type MNetRegionalProfileV03FromSchema = typeof MNetRegionalProfileV03Schema.Type
