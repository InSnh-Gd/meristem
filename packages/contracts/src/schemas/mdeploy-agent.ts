import * as Schema from 'effect/Schema'
import { MDeployDigestSchema, MDeployRuntimeDriverSchema } from './mdeploy-common.ts'
import { MDeployRuntimeDriverSelectionV01Schema } from './mdeploy-operations.ts'

export const MDeployAgentConnectionStatusSchema = Schema.Literals(['connected', 'disconnected'])
export type MDeployAgentConnectionStatusFromSchema = typeof MDeployAgentConnectionStatusSchema.Type

export const MDeployAgentHealthSchema = Schema.Literals(['healthy', 'degraded', 'unhealthy'])
export type MDeployAgentHealthFromSchema = typeof MDeployAgentHealthSchema.Type

export const MDeployDriftStatusSchema = Schema.Literals(['none', 'suspected', 'confirmed'])
export type MDeployDriftStatusFromSchema = typeof MDeployDriftStatusSchema.Type

export const MDeployDriverCapabilityV01Schema = Schema.Struct({
  runtimeDriver: MDeployRuntimeDriverSchema,
  version: Schema.String,
  features: Schema.Array(Schema.String)
})
export type MDeployDriverCapabilityV01FromSchema = typeof MDeployDriverCapabilityV01Schema.Type

export const MDeployControllerTrustMaterialV01Schema = Schema.Struct({
  issuer: Schema.String,
  audience: Schema.String,
  publicKeyFingerprint: Schema.String,
  expiresAt: Schema.String
})
export type MDeployControllerTrustMaterialV01FromSchema =
  typeof MDeployControllerTrustMaterialV01Schema.Type

export const MDeployAgentEnrollmentV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.agent-enrollment@0.1.0'),
  agentId: Schema.String,
  hostId: Schema.String,
  capabilities: Schema.Array(MDeployDriverCapabilityV01Schema),
  controllerTrust: MDeployControllerTrustMaterialV01Schema,
  enrolledAt: Schema.String
})
export type MDeployAgentEnrollmentV01FromSchema = typeof MDeployAgentEnrollmentV01Schema.Type

export const MDeployAgentHeartbeatV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.agent-heartbeat@0.1.0'),
  agentId: Schema.String,
  timestamp: Schema.String,
  lastAppliedDigest: Schema.optional(MDeployDigestSchema),
  driftStatus: MDeployDriftStatusSchema,
  health: MDeployAgentHealthSchema,
  connectionStatus: MDeployAgentConnectionStatusSchema,
  runtimeDrivers: Schema.Array(MDeployRuntimeDriverSchema),
  correlationId: Schema.optional(Schema.String)
})
export type MDeployAgentHeartbeatV01FromSchema = typeof MDeployAgentHeartbeatV01Schema.Type

export const MDeployRuntimeHealthV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.runtime-health@0.1.0'),
  agentId: Schema.String,
  hostId: Schema.String,
  runtime: MDeployRuntimeDriverSelectionV01Schema,
  health: MDeployAgentHealthSchema,
  checkedAt: Schema.String,
  checks: Schema.Struct({
    runtimeAvailable: Schema.Boolean,
    unitManagerAvailable: Schema.Boolean,
    immutableImageVerified: Schema.Boolean
  }),
  appliedImageDigest: Schema.optional(MDeployDigestSchema)
})
export type MDeployRuntimeHealthV01FromSchema = typeof MDeployRuntimeHealthV01Schema.Type

export const MDeployDriftTypeSchema = Schema.Literals([
  'runtime_state',
  'iac_state',
  'artifact_digest',
  'service_config'
])
export type MDeployDriftTypeFromSchema = typeof MDeployDriftTypeSchema.Type

export const MDeployDriftSeveritySchema = Schema.Literals(['low', 'medium', 'high', 'critical'])
export type MDeployDriftSeverityFromSchema = typeof MDeployDriftSeveritySchema.Type

export const MDeployStateDigestRefV01Schema = Schema.Struct({
  digest: MDeployDigestSchema,
  source: Schema.Literals(['git', 'agent', 'iac', 'runtime'])
})
export type MDeployStateDigestRefV01FromSchema = typeof MDeployStateDigestRefV01Schema.Type

export const MDeployDriftReportV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.drift-report@0.1.0'),
  reportId: Schema.String,
  agentId: Schema.String,
  expectedState: MDeployStateDigestRefV01Schema,
  actualState: MDeployStateDigestRefV01Schema,
  driftType: MDeployDriftTypeSchema,
  severity: MDeployDriftSeveritySchema,
  timestamp: Schema.String,
  resolvedAt: Schema.optional(Schema.String)
})
export type MDeployDriftReportV01FromSchema = typeof MDeployDriftReportV01Schema.Type

export function deriveMDeployAgentConnectionStatus(
  heartbeat: MDeployAgentHeartbeatV01FromSchema,
  now: string,
  heartbeatTimeoutMs: number
): MDeployAgentConnectionStatusFromSchema {
  const nowMs = Date.parse(now)
  const heartbeatMs = Date.parse(heartbeat.timestamp)
  if (!Number.isFinite(nowMs) || !Number.isFinite(heartbeatMs)) return 'disconnected'
  return nowMs - heartbeatMs > heartbeatTimeoutMs ? 'disconnected' : heartbeat.connectionStatus
}

export const MDeployAgentHeartbeatPayloadSchema = MDeployAgentHeartbeatV01Schema
export type MDeployAgentHeartbeatPayloadFromSchema = typeof MDeployAgentHeartbeatPayloadSchema.Type

export const MDeployDriftDetectedPayloadSchema = MDeployDriftReportV01Schema
export type MDeployDriftDetectedPayloadFromSchema = typeof MDeployDriftDetectedPayloadSchema.Type

export const MDeployDriftResolvedPayloadSchema = MDeployDriftReportV01Schema
export type MDeployDriftResolvedPayloadFromSchema = typeof MDeployDriftResolvedPayloadSchema.Type
