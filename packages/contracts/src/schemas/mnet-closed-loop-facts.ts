import * as Schema from 'effect/Schema'
import {
  MNetProfileV03VersionSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthStatusSchema
} from './mnet-profile-v03.ts'

function issue(path: readonly PropertyKey[], message: string): Schema.FilterIssue {
  return { path, issue: message }
}

export const MNetClosedLoopContractVersionSchema = Schema.Literal('mnet-closed-loop@0.1.0')
export type MNetClosedLoopContractVersionFromSchema =
  typeof MNetClosedLoopContractVersionSchema.Type

export const MNetClosedLoopStateSourceSchema = Schema.Literals([
  'postgresql-authoritative',
  'eventbus-fact',
  'm-log-audit',
  'm-log-timeline',
  'm-log-full',
  'opensearch-projection',
  'nats-kv-cache',
  'composed-ui-fact'
])
export type MNetClosedLoopStateSourceFromSchema = typeof MNetClosedLoopStateSourceSchema.Type

export const MNetNodeKindSchema = Schema.Literals(['core', 'stem', 'leaf'])
export type MNetNodeKindFromSchema = typeof MNetNodeKindSchema.Type

export const MNetNodeRuntimeStateSchema = Schema.Literals([
  'joining',
  'healthy',
  'degraded',
  'offline',
  'disabled',
  'isolated',
  'recovering',
  'revoked'
])
export type MNetNodeRuntimeStateFromSchema = typeof MNetNodeRuntimeStateSchema.Type

export const MNetJoinCredentialStatusSchema = Schema.Literals([
  'pending',
  'issued',
  'active',
  'rotating',
  'revoked',
  'expired'
])
export type MNetJoinCredentialStatusFromSchema = typeof MNetJoinCredentialStatusSchema.Type

export const MNetMapFreshnessSchema = Schema.Literals(['fresh', 'stale', 'expired', 'fail_closed'])
export type MNetMapFreshnessFromSchema = typeof MNetMapFreshnessSchema.Type

export const MNetSignedTopologyMapStatusSchema = Schema.Struct({
  mapId: Schema.String,
  networkId: Schema.String,
  topologyRevision: Schema.String,
  signedBy: Schema.String,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  freshness: MNetMapFreshnessSchema,
  stateSource: Schema.Literal('nats-kv-cache'),
  validation: Schema.Literals(['valid', 'signature_invalid', 'stale', 'expired'])
})
export type MNetSignedTopologyMapStatusFromSchema = typeof MNetSignedTopologyMapStatusSchema.Type

export const MNetKeyRegistrationStatusSchema = Schema.Struct({
  nodeId: Schema.String,
  publicKeyFingerprint: Schema.String,
  status: Schema.Literals(['registered', 'rotation_required', 'revoked', 'stale']),
  lastValidatedAt: Schema.String,
  auditId: Schema.optional(Schema.String)
})
export type MNetKeyRegistrationStatusFromSchema = typeof MNetKeyRegistrationStatusSchema.Type

export const MNetTunnelModeSchema = Schema.Literals(['direct', 'relay', 'forced-relay', 'none'])
export type MNetTunnelModeFromSchema = typeof MNetTunnelModeSchema.Type

export const MNetTunnelHealthSchema = Schema.Struct({
  nodeId: Schema.String,
  peerNodeId: Schema.String,
  status: Schema.Literals(['up', 'degraded', 'down']),
  mode: MNetTunnelModeSchema,
  latencyMs: Schema.optional(Schema.Number),
  packetLossPct: Schema.optional(Schema.Number),
  relayStatus: Schema.Literals(['not-required', 'available', 'forced', 'unavailable']),
  checkedAt: Schema.String,
  stateSource: Schema.Literals(['opensearch-projection', 'node-runtime-report'])
})
export type MNetTunnelHealthFromSchema = typeof MNetTunnelHealthSchema.Type

export const MNetSidecarDegradedReasonSchema = Schema.Literals([
  'expired_credentials',
  'missing_signal',
  'missing_relay',
  'missing_stun',
  'secret.missing',
  'secret.denied',
  'secret.provider_unavailable',
  'secret.unsupported_backend',
  'secret.stale',
  'sidecar_crash',
  'config_drift',
  'break_glass_stop',
  'profile_disabled',
  'netbird.binary.invalid',
  'netbird.setup_key.missing',
  'netbird.start_failed',
  'netbird.process.not_running',
  'netbird.config_drift_repaired',
  'netbird.process_restarted',
  'netbird.probe.not_connected',
  'netbird.probe.timeout',
  'netbird.probe.failed',
  'netbird.endpoint.unreachable',
  'netbird.config.forbidden_management_plane',
  'netbird.config.missing_control_plane',
  'netbird.config.invalid_control_plane',
  'unsupported_management_dependency',
  'wireguard_rendered_fallback'
])
export type MNetSidecarDegradedReasonFromSchema = typeof MNetSidecarDegradedReasonSchema.Type

export const MNetSidecarStatusSchema = Schema.Struct({
  nodeId: Schema.String,
  desiredState: MNetSidecarDesiredStateSchema,
  healthStatus: MNetSidecarHealthStatusSchema,
  degradedReason: Schema.optional(MNetSidecarDegradedReasonSchema),
  proofPath: Schema.Literals(['sidecar-proof', 'runtime-probe', 'operator-report']),
  fallbackTransport: Schema.optional(Schema.Literal('wireguard-rendered')),
  uiFacingFact: Schema.Literal(true),
  healthy: Schema.Boolean,
  checkedAt: Schema.String
}).pipe(
  Schema.check(
    Schema.makeFilter(value => {
      const issues: Array<Schema.FilterIssue> = []
      const degraded = value.healthStatus === 'degraded' || value.healthStatus === 'unhealthy'
      if (value.healthStatus === 'healthy' && !value.healthy)
        issues.push(issue(['healthy'], 'healthy sidecar status must project healthy true'))
      if (value.healthStatus !== 'healthy' && value.healthy)
        issues.push(issue(['healthy'], 'non-healthy sidecar status must project healthy false'))
      if (degraded && !value.degradedReason)
        issues.push(issue(['degradedReason'], 'degraded sidecar status requires a typed reason'))
      if (value.fallbackTransport && !degraded)
        issues.push(
          issue(
            ['fallbackTransport'],
            'fallback transport is only valid for degraded sidecar status'
          )
        )
      return issues
    })
  )
)
export type MNetSidecarStatusFromSchema = typeof MNetSidecarStatusSchema.Type

export const MNetSidecarDegradedStatusSchema = MNetSidecarStatusSchema.pipe(
  Schema.check(
    Schema.makeFilter(value =>
      value.healthStatus === 'degraded' || value.healthStatus === 'unhealthy'
        ? []
        : [issue(['healthStatus'], 'sidecar degraded event requires degraded or unhealthy status')]
    )
  )
)
export type MNetSidecarDegradedStatusFromSchema = typeof MNetSidecarDegradedStatusSchema.Type

export const MNetRelayPolicyStateSchema = Schema.Literals(['enabled', 'disabled', 'denied'])
export type MNetRelayPolicyStateFromSchema = typeof MNetRelayPolicyStateSchema.Type

export const MNetTopologyViewNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  nodeKind: MNetNodeKindSchema,
  runtimeState: MNetNodeRuntimeStateSchema,
  profileVersion: MNetProfileV03VersionSchema,
  sidecar: MNetSidecarStatusSchema,
  credentialStatus: MNetJoinCredentialStatusSchema,
  keyStatus: MNetKeyRegistrationStatusSchema
})
export type MNetTopologyViewNodeFromSchema = typeof MNetTopologyViewNodeSchema.Type

export const MNetTopologyViewNetworkSchema = Schema.Struct({
  networkId: Schema.String,
  displayName: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  status: Schema.Literals(['healthy', 'degraded', 'fail_closed', 'migration_required']),
  mapStatus: MNetSignedTopologyMapStatusSchema,
  relayPolicyState: MNetRelayPolicyStateSchema
})
export type MNetTopologyViewNetworkFromSchema = typeof MNetTopologyViewNetworkSchema.Type

export const MNetTopologyViewSchema = Schema.Struct({
  contractVersion: MNetClosedLoopContractVersionSchema,
  generatedAt: Schema.String,
  stateSource: Schema.Literal('composed-ui-fact'),
  networks: Schema.Array(MNetTopologyViewNetworkSchema),
  nodes: Schema.Array(MNetTopologyViewNodeSchema),
  profiles: Schema.Array(MNetProfileV03VersionSchema),
  tunnelHealth: Schema.Array(MNetTunnelHealthSchema),
  sidecarStatuses: Schema.Array(MNetSidecarStatusSchema),
  degraded: Schema.Boolean,
  correlationId: Schema.String
})
export type MNetTopologyViewFromSchema = typeof MNetTopologyViewSchema.Type
