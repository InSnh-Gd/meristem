import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import { MNetRuntimeConfigSchema } from './runtime-config.ts'

export const MNetProfileVersionSchema = Schema.Literal(
  'm-net-cn@0.1.0',
  'm-net-cn@0.2.0',
  'm-net-default@0.1.0'
)
export type MNetProfileVersionFromSchema = typeof MNetProfileVersionSchema.Type

export const MNetProfileRegionSchema = Schema.Literal('cn', 'default')
export type MNetProfileRegionFromSchema = typeof MNetProfileRegionSchema.Type

export const MNetProfileSchemaVersionSchema = Schema.Literal(
  'mnet-profile@0.1.0',
  'mnet-profile@0.2.0'
)
export type MNetProfileSchemaVersionFromSchema = typeof MNetProfileSchemaVersionSchema.Type

export const MNetRegionalProfileCapabilitiesSchema = Schema.Struct({
  realWstunnelRelay: Schema.Literal(false),
  realTcpInterconnect: Schema.Literal(false),
  realUdpPathSwitching: Schema.Literal(false),
  controlPlaneOnly: Schema.Boolean,
  realWireGuardTunnel: Schema.optional(Schema.Boolean),
  realRelayFallback: Schema.optional(Schema.Boolean)
})
export type MNetRegionalProfileCapabilitiesFromSchema =
  typeof MNetRegionalProfileCapabilitiesSchema.Type

const MNetRegionalProfileBaseSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  region: MNetProfileRegionSchema,
  displayName: Schema.String,
  schemaVersion: MNetProfileSchemaVersionSchema,
  status: Schema.Literal('available', 'deprecated'),
  rules: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  capabilities: MNetRegionalProfileCapabilitiesSchema,
  runtimeConfig: Schema.optional(MNetRuntimeConfigSchema)
})

export const MNetRegionalProfileSchema = MNetRegionalProfileBaseSchema.pipe(
  Schema.filter(profile => {
    const issues: Array<Schema.FilterIssue> = []

    if (profile.profileVersion === 'm-net-cn@0.2.0') {
      if (profile.schemaVersion !== 'mnet-profile@0.2.0') {
        issues.push({
          path: ['schemaVersion'],
          message: '0.2.0 profiles require mnet-profile@0.2.0'
        })
      }
      if (profile.capabilities.controlPlaneOnly !== false) {
        issues.push({
          path: ['capabilities', 'controlPlaneOnly'],
          message: '0.2.0 profiles enable the data plane'
        })
      }
      if (profile.capabilities.realWireGuardTunnel !== true) {
        issues.push({
          path: ['capabilities', 'realWireGuardTunnel'],
          message: '0.2.0 profiles require WireGuard tunnel capability'
        })
      }
      if (profile.capabilities.realRelayFallback !== true) {
        issues.push({
          path: ['capabilities', 'realRelayFallback'],
          message: '0.2.0 profiles require relay fallback capability'
        })
      }
      if (profile.runtimeConfig === undefined) {
        issues.push({ path: ['runtimeConfig'], message: '0.2.0 profiles require runtimeConfig' })
      }
      return issues
    }

    if (profile.schemaVersion !== 'mnet-profile@0.1.0') {
      issues.push({ path: ['schemaVersion'], message: '0.1.0 profiles require mnet-profile@0.1.0' })
    }
    if (
      profile.profileVersion === 'm-net-cn@0.1.0' &&
      profile.capabilities.controlPlaneOnly !== true
    ) {
      issues.push({
        path: ['capabilities', 'controlPlaneOnly'],
        message: 'm-net-cn@0.1.0 stays control-plane only'
      })
    }
    if (profile.capabilities.realWireGuardTunnel !== undefined) {
      issues.push({
        path: ['capabilities', 'realWireGuardTunnel'],
        message: '0.1.x profiles do not expose WireGuard capability'
      })
    }
    if (profile.capabilities.realRelayFallback !== undefined) {
      issues.push({
        path: ['capabilities', 'realRelayFallback'],
        message: '0.1.x profiles do not expose relay fallback capability'
      })
    }
    if (profile.runtimeConfig !== undefined) {
      issues.push({
        path: ['runtimeConfig'],
        message: '0.1.x profiles do not expose runtimeConfig'
      })
    }
    return issues
  })
)
export type MNetRegionalProfileFromSchema = typeof MNetRegionalProfileSchema.Type

export const SetNetworkProfileRequestSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  reason: Schema.String
})
export type SetNetworkProfileRequestFromSchema = typeof SetNetworkProfileRequestSchema.Type

export const NetworkProfileStateSchema = Schema.Literal(
  'disabled',
  'enabling',
  'enabled',
  'disabling',
  'failed'
)
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

export const NetworkSuspendedOperationStatusSchema = Schema.Literal(
  'suspended',
  'resumed',
  'rejected',
  'expired',
  'resume_failed'
)
export type NetworkSuspendedOperationStatusFromSchema =
  typeof NetworkSuspendedOperationStatusSchema.Type

export const NetworkSuspendedOperationSchema = Schema.Struct({
  id: Schema.String,
  policyDecisionId: Schema.String,
  action: Schema.Literal('mnet.profile.enable', 'mnet.profile.disable'),
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
  'mnet.profile.enable.canceled.v0',
  'mnet.reachability.changed.v0',
  'mnet.path.changed.v0',
  'mnet.wstunnel.fallback.changed.v0',
  'mnet.network_map.published.v0',
  'mnet.node_key.rotated.v0',
  'mnet.relay.assigned.v0',
  'mnet.dataplane.tunnel.changed.v0'
)
export type MNetProfileEventSubjectFromSchema = typeof MNetProfileEventSubjectSchema.Type

export const MNetProfileEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  fromProfileVersion: MNetProfileVersionSchema,
  toProfileVersion: MNetProfileVersionSchema,
  actor: Schema.Union(Schema.Literal(...actorIds), Schema.Literal('system')),
  policyDecisionId: Schema.String,
  approvalId: Schema.optional(Schema.String),
  operationId: Schema.optional(Schema.String),
  correlationId: Schema.String,
  reason: Schema.String,
  controlPlaneOnly: Schema.Literal(true)
})
export type MNetProfileEventPayloadFromSchema = typeof MNetProfileEventPayloadSchema.Type

/** 全局默认 Profile 更新事件 payload（DFW-014） */
export const MNetProfileDefaultsUpdatedEventPayloadSchema = Schema.Struct({
  defaultProfileVersion: MNetProfileVersionSchema,
  actor: Schema.Literal(...actorIds),
  reason: Schema.String,
  correlationId: Schema.String,
  controlPlaneOnly: Schema.Literal(true)
})
export type MNetProfileDefaultsUpdatedEventPayloadFromSchema =
  typeof MNetProfileDefaultsUpdatedEventPayloadSchema.Type

export const MNetRelayTypeSchema = Schema.Literal('wstunnel', 'direct')
export type MNetRelayTypeFromSchema = typeof MNetRelayTypeSchema.Type

export const MNetTunnelStatusSchema = Schema.Literal('up', 'down', 'degraded')
export type MNetTunnelStatusFromSchema = typeof MNetTunnelStatusSchema.Type

export const MNetPathTypeSchema = Schema.Literal('direct', 'relay', 'none')
export type MNetPathTypeFromSchema = typeof MNetPathTypeSchema.Type

export const MNetNetworkMapMemberSchema = Schema.Struct({
  nodeId: Schema.String,
  tunnelIp: Schema.String,
  publicKeyFingerprint: Schema.String
})
export type MNetNetworkMapMemberFromSchema = typeof MNetNetworkMapMemberSchema.Type

export const MNetNetworkMapRelayAssignmentSchema = Schema.Struct({
  relayType: MNetRelayTypeSchema,
  relayEndpoint: Schema.String,
  nodeIds: Schema.Array(Schema.String)
})
export type MNetNetworkMapRelayAssignmentFromSchema =
  typeof MNetNetworkMapRelayAssignmentSchema.Type

export const MNetRelayAssignmentSchema = Schema.Struct({
  nodeId: Schema.String,
  relayEndpoint: Schema.String,
  relayType: MNetRelayTypeSchema
})
export type MNetRelayAssignmentFromSchema = typeof MNetRelayAssignmentSchema.Type

export const MNetAclRuleSchema = Schema.Struct({
  ruleId: Schema.String,
  action: Schema.Literal('allow', 'deny'),
  sourceNodeId: Schema.String,
  targetNodeId: Schema.String,
  protocol: Schema.Literal('any', 'tcp', 'udp', 'icmp')
})
export type MNetAclRuleFromSchema = typeof MNetAclRuleSchema.Type

// 节点侧执行使用已渲染 ACL，不在 agent 上重新调用策略服务。
export const AclRuleSchema = MNetAclRuleSchema
export type AclRuleFromSchema = typeof AclRuleSchema.Type

export const NetworkMapMemberSchema = Schema.Struct({
  nodeId: Schema.String,
  tunnelIp: Schema.String,
  publicKey: Schema.String,
  /**
   * 节点的公网 WireGuard 端点（如 `203.0.113.5:51820`），用于直接 P2P 连接。
   * 缺省时 node-agent 回退到 wstunnel relay。
   */
  endpoint: Schema.optional(Schema.String)
})
export type NetworkMapMemberFromSchema = typeof NetworkMapMemberSchema.Type

export const NetworkMapSigningMetadataSchema = Schema.Struct({
  algorithm: Schema.Literal('ed25519'),
  keyId: Schema.String,
  publicKey: Schema.String,
  value: Schema.String
})
export type NetworkMapSigningMetadataFromSchema = typeof NetworkMapSigningMetadataSchema.Type

export const NetworkMapSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  networkId: Schema.String,
  members: Schema.Array(NetworkMapMemberSchema),
  aclRules: Schema.Array(AclRuleSchema),
  relayAssignment: Schema.optional(MNetNetworkMapRelayAssignmentSchema),
  expiresAt: Schema.Number,
  mapVersion: Schema.Number,
  signatureMetadata: NetworkMapSigningMetadataSchema
})
export type NetworkMapFromSchema = typeof NetworkMapSchema.Type

export const NetworkMapEnforcementReasonSchema = Schema.Literal(
  'network_map.stale',
  'network_map.invalid_signature',
  'network_map.version_regression'
)
export type NetworkMapEnforcementReasonFromSchema = typeof NetworkMapEnforcementReasonSchema.Type

export const NetworkMapEnforcementDecisionSchema = Schema.Union(
  Schema.Struct({ decision: Schema.Literal('apply') }),
  Schema.Struct({
    decision: Schema.Literal('fail_closed'),
    reason: NetworkMapEnforcementReasonSchema
  })
)
export type NetworkMapEnforcementDecisionFromSchema =
  typeof NetworkMapEnforcementDecisionSchema.Type

export const MNetNetworkMapReferenceSchema = Schema.Struct({
  networkId: Schema.String,
  mapVersion: Schema.String
})
export type MNetNetworkMapReferenceFromSchema = typeof MNetNetworkMapReferenceSchema.Type

export const MNetReachabilityChangedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  reachable: Schema.Boolean,
  latencyMs: Schema.optional(Schema.Number),
  checkedAt: Schema.String,
  correlationId: Schema.String
})
export type MNetReachabilityChangedEventPayloadFromSchema =
  typeof MNetReachabilityChangedEventPayloadSchema.Type

export const MNetPathChangedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  pathType: MNetPathTypeSchema,
  previousPathType: MNetPathTypeSchema,
  relayEndpoint: Schema.optional(Schema.String),
  correlationId: Schema.String
})
export type MNetPathChangedEventPayloadFromSchema = typeof MNetPathChangedEventPayloadSchema.Type

export const MNetWstunnelFallbackChangedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  fallbackActive: Schema.Boolean,
  reason: Schema.String,
  correlationId: Schema.String
})
export type MNetWstunnelFallbackChangedEventPayloadFromSchema =
  typeof MNetWstunnelFallbackChangedEventPayloadSchema.Type

export const MNetNetworkMapPublishedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  mapVersion: Schema.String,
  members: Schema.Array(MNetNetworkMapMemberSchema),
  relayAssignment: MNetNetworkMapRelayAssignmentSchema,
  aclRules: Schema.Array(MNetAclRuleSchema),
  expiresAt: Schema.String,
  signedBy: Schema.String,
  correlationId: Schema.String
})
export type MNetNetworkMapPublishedEventPayloadFromSchema =
  typeof MNetNetworkMapPublishedEventPayloadSchema.Type

export const MNetNodeKeyRotatedEventPayloadSchema = Schema.Struct({
  nodeId: Schema.String,
  oldKeyFingerprint: Schema.String,
  newKeyFingerprint: Schema.String,
  rotationReason: Schema.String,
  actor: Schema.Union(Schema.Literal(...actorIds), Schema.Literal('system')),
  correlationId: Schema.String,
  auditId: Schema.String
})
export type MNetNodeKeyRotatedEventPayloadFromSchema =
  typeof MNetNodeKeyRotatedEventPayloadSchema.Type

export const MNetRelayAssignedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  relayEndpoint: Schema.String,
  relayType: MNetRelayTypeSchema,
  correlationId: Schema.String
})
export type MNetRelayAssignedEventPayloadFromSchema =
  typeof MNetRelayAssignedEventPayloadSchema.Type

export const MNetDataplaneTunnelChangedEventPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  tunnelStatus: MNetTunnelStatusSchema,
  previousStatus: MNetTunnelStatusSchema,
  reason: Schema.String,
  correlationId: Schema.String
})
export type MNetDataplaneTunnelChangedEventPayloadFromSchema =
  typeof MNetDataplaneTunnelChangedEventPayloadSchema.Type

export const MNetProfileListResponseSchema = Schema.Struct({
  profiles: Schema.Array(MNetRegionalProfileSchema)
})
export type MNetProfileListResponseFromSchema = typeof MNetProfileListResponseSchema.Type

export const SetNetworkProfilePendingApprovalResponseSchema = Schema.Struct({
  status: Schema.Literal('pending_approval'),
  operationId: Schema.String,
  approvalId: Schema.optional(Schema.String),
  correlationId: Schema.String
})
export type SetNetworkProfilePendingApprovalResponseFromSchema =
  typeof SetNetworkProfilePendingApprovalResponseSchema.Type

export const SetNetworkProfileDisabledResponseSchema = Schema.Struct({
  status: Schema.Literal('disabled'),
  profileVersion: MNetProfileVersionSchema,
  correlationId: Schema.String
})
export type SetNetworkProfileDisabledResponseFromSchema =
  typeof SetNetworkProfileDisabledResponseSchema.Type

export const MNetDataPlaneActivationStatusSchema = Schema.Literal(
  'activating',
  'active',
  'degraded'
)
export type MNetDataPlaneActivationStatusFromSchema =
  typeof MNetDataPlaneActivationStatusSchema.Type

export const SetNetworkProfileDataPlaneActivatedResponseSchema = Schema.Struct({
  status: Schema.Literal('activated'),
  profileVersion: Schema.Literal('m-net-cn@0.2.0'),
  operationId: Schema.String,
  networkMap: MNetNetworkMapReferenceSchema,
  dataPlaneActivationStatus: MNetDataPlaneActivationStatusSchema,
  correlationId: Schema.String
})
export type SetNetworkProfileDataPlaneActivatedResponseFromSchema =
  typeof SetNetworkProfileDataPlaneActivatedResponseSchema.Type

export const SetNetworkProfileResponseSchema = Schema.Union(
  SetNetworkProfilePendingApprovalResponseSchema,
  SetNetworkProfileDisabledResponseSchema,
  SetNetworkProfileDataPlaneActivatedResponseSchema
)
export type SetNetworkProfileResponseFromSchema = typeof SetNetworkProfileResponseSchema.Type

export const NetworkMapResponseSchema = Schema.Struct({
  networkId: Schema.String,
  mapVersion: Schema.String,
  members: Schema.Array(MNetNetworkMapMemberSchema),
  relayAssignment: MNetNetworkMapRelayAssignmentSchema,
  aclRules: Schema.Array(MNetAclRuleSchema),
  expiresAt: Schema.String,
  signedBy: Schema.String
})
export type NetworkMapResponseFromSchema = typeof NetworkMapResponseSchema.Type

export const NodeKeyMetadataSchema = Schema.Struct({
  algorithm: Schema.Literal('wireguard-x25519'),
  issuedAt: Schema.String,
  rotationCounter: Schema.Number,
  publicKeyFingerprint: Schema.String
})
export type NodeKeyMetadataFromSchema = typeof NodeKeyMetadataSchema.Type

export const NodeKeyRegistrationResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  keyFingerprint: Schema.String,
  keyMetadata: NodeKeyMetadataSchema,
  expiresAt: Schema.String
})
export type NodeKeyRegistrationResponseFromSchema = typeof NodeKeyRegistrationResponseSchema.Type

export const MNetPartitionStateSchema = Schema.Literal('connected', 'partitioned', 'unknown')
export type MNetPartitionStateFromSchema = typeof MNetPartitionStateSchema.Type

export const DataPlaneStatusResponseSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  tunnelStatus: MNetTunnelStatusSchema,
  relayAssignment: MNetRelayAssignmentSchema,
  lastMapVersion: Schema.String,
  lastMapAt: Schema.String,
  partitionState: MNetPartitionStateSchema
})
export type DataPlaneStatusResponseFromSchema = typeof DataPlaneStatusResponseSchema.Type

export const InternalNetworkProfileResumeResponseSchema = Schema.Struct({
  status: Schema.Literal('resumed'),
  operationId: Schema.String
})
export type InternalNetworkProfileResumeResponseFromSchema =
  typeof InternalNetworkProfileResumeResponseSchema.Type

export const InternalNetworkProfileRejectResponseSchema = Schema.Struct({
  status: Schema.Literal('rejected'),
  operationId: Schema.String
})
export type InternalNetworkProfileRejectResponseFromSchema =
  typeof InternalNetworkProfileRejectResponseSchema.Type
