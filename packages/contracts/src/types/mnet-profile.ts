import type {
  DataPlaneStatusResponseSchema,
  InternalNetworkProfileRejectResponseSchema,
  InternalNetworkProfileResumeResponseSchema,
  MNetActiveProfileVersionSchema,
  MNetAclRuleSchema,
  MNetDataPlaneActivationStatusSchema,
  MNetDataplaneTunnelChangedEventPayloadSchema,
  MNetNetworkMapMemberSchema,
  MNetNetworkMapPublishedEventPayloadSchema,
  MNetNetworkMapReferenceSchema,
  MNetNetworkMapRelayAssignmentSchema,
  MNetNodeKeyRotatedEventPayloadSchema,
  MNetPartitionStateSchema,
  MNetPathChangedEventPayloadSchema,
  MNetPathTypeSchema,
  MNetProfileDefaultsUpdatedEventPayloadSchema,
  MNetProfileEventPayloadSchema,
  MNetProfileEventSubjectSchema,
  MNetHistoricalProfileVersionSchema,
  MNetProfileListResponseSchema,
  MNetProfileRegionSchema,
  MNetProfileSchemaVersionSchema,
  MNetProfileVersionSchema,
  MNetReachabilityChangedEventPayloadSchema,
  MNetRegionalProfileSchema,
  MNetRelayAssignedEventPayloadSchema,
  MNetRelayAssignmentSchema,
  MNetRelayTypeSchema,
  MNetTunnelStatusSchema,
  MNetWstunnelFallbackChangedEventPayloadSchema,
  NetworkMapResponseSchema,
  NetworkProfileStateSchema,
  NetworkProfileSummarySchema,
  NetworkSuspendedOperationSchema,
  NetworkSuspendedOperationStatusSchema,
  NodeKeyMetadataSchema,
  NodeKeyRegistrationResponseSchema,
  SetNetworkProfileDataPlaneActivatedResponseSchema,
  SetNetworkProfileDisabledResponseSchema,
  SetNetworkProfilePendingApprovalResponseSchema,
  SetNetworkProfileRequestSchema,
  SetNetworkProfileResponseSchema
} from '../schemas/mnet-profile.ts'
import type {
  MNetCnProfileV03Schema,
  MNetCredentialExpiryEventPayloadSchema,
  MNetForcedRelayChangeEventPayloadSchema,
  MNetForcedTcpRelaySelectorSchema,
  MNetMigrationReportItemSchema,
  MNetMigrationReportSchema,
  MNetMigrationRequiredCliOutputSchema,
  MNetMigrationRequiredDisabledReasonSchema,
  MNetMigrationRequiredErrorSchema,
  MNetMigrationRequiredEventPayloadSchema,
  MNetMigrationRequiredGuidanceKeySchema,
  MNetMigrationRequiredReasonCodeSchema,
  MNetMigrationRequiredSchema,
  MNetNetBirdDataPlaneCapabilitiesSchema,
  MNetNodeRuntimeProfileSchema,
  MNetNodeSelectorSchema,
  MNetNodeV03CompatibilityResultSchema,
  MNetPolicyDecisionRefSchema,
  MNetProfileV03CompatibilityResultSchema,
  MNetProfileV03EventSubjectSchema,
  MNetProfileV03Schema,
  MNetProfileV03SchemaVersionSchema,
  MNetProfileV03VersionSchema,
  MNetRegionalProfileV03Schema,
  MNetRouteClassSchema,
  MNetSelectorOwnershipSchema,
  MNetSidecarCredentialStatusSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthEventPayloadSchema,
  MNetSidecarHealthStatusSchema,
  MNetSidecarLifecycleEventPayloadSchema,
  MNetTopologyUpdateEventPayloadSchema
} from '../schemas/mnet-profile-v03.ts'

export type MNetProfileVersion = typeof MNetProfileVersionSchema.Type
export type MNetActiveProfileVersion = typeof MNetActiveProfileVersionSchema.Type
export type MNetHistoricalProfileVersion = typeof MNetHistoricalProfileVersionSchema.Type
export type MNetProfileV03Version = typeof MNetProfileV03VersionSchema.Type
export type MNetProfileRegion = typeof MNetProfileRegionSchema.Type
export type MNetProfileSchemaVersion = typeof MNetProfileSchemaVersionSchema.Type
export type MNetProfileV03SchemaVersion = typeof MNetProfileV03SchemaVersionSchema.Type
export type MNetRegionalProfileCapabilities = typeof MNetNetBirdDataPlaneCapabilitiesSchema.Type
export type MNetRegionalProfile = typeof MNetRegionalProfileSchema.Type
export type MNetNetBirdDataPlaneCapabilities = typeof MNetNetBirdDataPlaneCapabilitiesSchema.Type
export type MNetProfileV03 = typeof MNetProfileV03Schema.Type
export type MNetCnProfileV03 = typeof MNetCnProfileV03Schema.Type
export type MNetRegionalProfileV03 = typeof MNetRegionalProfileV03Schema.Type
export type MNetRouteClass = typeof MNetRouteClassSchema.Type
export type MNetSelectorOwnership = typeof MNetSelectorOwnershipSchema.Type
export type MNetNodeSelector = typeof MNetNodeSelectorSchema.Type
export type MNetForcedTcpRelaySelector = typeof MNetForcedTcpRelaySelectorSchema.Type
export type MNetPolicyDecisionRef = typeof MNetPolicyDecisionRefSchema.Type
export type MNetSidecarDesiredState = typeof MNetSidecarDesiredStateSchema.Type
export type MNetSidecarCredentialStatus = typeof MNetSidecarCredentialStatusSchema.Type
export type MNetSidecarHealthStatus = typeof MNetSidecarHealthStatusSchema.Type

export type SetNetworkProfileRequest = typeof SetNetworkProfileRequestSchema.Type

export type NetworkProfileState = typeof NetworkProfileStateSchema.Type
export type NetworkProfileSummary = typeof NetworkProfileSummarySchema.Type

export type NetworkSuspendedOperationStatus = typeof NetworkSuspendedOperationStatusSchema.Type
type MutableSchemaType<T> = { -readonly [K in keyof T]: T[K] }
export type NetworkSuspendedOperation = MutableSchemaType<
  typeof NetworkSuspendedOperationSchema.Type
>

export type MNetProfileEventSubject = typeof MNetProfileEventSubjectSchema.Type
export type MNetProfileV03EventSubject = typeof MNetProfileV03EventSubjectSchema.Type
export type MNetProfileEventPayload = typeof MNetProfileEventPayloadSchema.Type

export type MNetProfileEnableRequestedEventPayload = MNetProfileEventPayload
export type MNetProfileEnabledEventPayload = MNetProfileEventPayload
export type MNetProfileDisableRequestedEventPayload = MNetProfileEventPayload
export type MNetProfileDisabledEventPayload = MNetProfileEventPayload
export type MNetProfileApplyFailedEventPayload = MNetProfileEventPayload
export type MNetProfileEnableCanceledEventPayload = MNetProfileEventPayload
export type MNetProfileDefaultsUpdatedEventPayload =
  typeof MNetProfileDefaultsUpdatedEventPayloadSchema.Type

export type MNetRelayType = typeof MNetRelayTypeSchema.Type
export type MNetTunnelStatus = typeof MNetTunnelStatusSchema.Type
export type MNetPathType = typeof MNetPathTypeSchema.Type
export type MNetNetworkMapMember = typeof MNetNetworkMapMemberSchema.Type
export type MNetNetworkMapRelayAssignment = typeof MNetNetworkMapRelayAssignmentSchema.Type
export type MNetRelayAssignment = typeof MNetRelayAssignmentSchema.Type
export type MNetAclRule = typeof MNetAclRuleSchema.Type
export type MNetNetworkMapReference = typeof MNetNetworkMapReferenceSchema.Type
export type MNetReachabilityChangedEventPayload =
  typeof MNetReachabilityChangedEventPayloadSchema.Type
export type MNetPathChangedEventPayload = typeof MNetPathChangedEventPayloadSchema.Type
export type MNetWstunnelFallbackChangedEventPayload =
  typeof MNetWstunnelFallbackChangedEventPayloadSchema.Type
export type MNetNetworkMapPublishedEventPayload =
  typeof MNetNetworkMapPublishedEventPayloadSchema.Type
export type MNetNodeKeyRotatedEventPayload = typeof MNetNodeKeyRotatedEventPayloadSchema.Type
export type MNetRelayAssignedEventPayload = typeof MNetRelayAssignedEventPayloadSchema.Type
export type MNetDataplaneTunnelChangedEventPayload =
  typeof MNetDataplaneTunnelChangedEventPayloadSchema.Type
export type MNetSidecarLifecycleEventPayload = typeof MNetSidecarLifecycleEventPayloadSchema.Type
export type MNetSidecarHealthEventPayload = typeof MNetSidecarHealthEventPayloadSchema.Type
export type MNetTopologyUpdateEventPayload = typeof MNetTopologyUpdateEventPayloadSchema.Type
export type MNetMigrationRequiredReasonCode = typeof MNetMigrationRequiredReasonCodeSchema.Type
export type MNetMigrationRequiredGuidanceKey = typeof MNetMigrationRequiredGuidanceKeySchema.Type
export type MNetMigrationRequired = typeof MNetMigrationRequiredSchema.Type
export type MNetMigrationRequiredError = typeof MNetMigrationRequiredErrorSchema.Type
export type MNetMigrationRequiredCliOutput = typeof MNetMigrationRequiredCliOutputSchema.Type
export type MNetMigrationReportItem = typeof MNetMigrationReportItemSchema.Type
export type MNetMigrationReport = typeof MNetMigrationReportSchema.Type
export type MNetMigrationRequiredDisabledReason =
  typeof MNetMigrationRequiredDisabledReasonSchema.Type
export type MNetMigrationRequiredEventPayload = typeof MNetMigrationRequiredEventPayloadSchema.Type
export type MNetForcedRelayChangeEventPayload = typeof MNetForcedRelayChangeEventPayloadSchema.Type
export type MNetCredentialExpiryEventPayload = typeof MNetCredentialExpiryEventPayloadSchema.Type
export type MNetProfileV03CompatibilityResult = typeof MNetProfileV03CompatibilityResultSchema.Type
export type MNetNodeRuntimeProfile = typeof MNetNodeRuntimeProfileSchema.Type
export type MNetNodeV03CompatibilityResult = typeof MNetNodeV03CompatibilityResultSchema.Type

export type MNetProfileListResponse = typeof MNetProfileListResponseSchema.Type
export type SetNetworkProfilePendingApprovalResponse =
  typeof SetNetworkProfilePendingApprovalResponseSchema.Type
export type SetNetworkProfileDisabledResponse = typeof SetNetworkProfileDisabledResponseSchema.Type
export type MNetDataPlaneActivationStatus = typeof MNetDataPlaneActivationStatusSchema.Type
export type SetNetworkProfileDataPlaneActivatedResponse =
  typeof SetNetworkProfileDataPlaneActivatedResponseSchema.Type
export type SetNetworkProfileResponse = typeof SetNetworkProfileResponseSchema.Type

export type NetworkMapResponse = typeof NetworkMapResponseSchema.Type
export type NodeKeyMetadata = typeof NodeKeyMetadataSchema.Type
export type NodeKeyRegistrationResponse = typeof NodeKeyRegistrationResponseSchema.Type
export type MNetPartitionState = typeof MNetPartitionStateSchema.Type
export type DataPlaneStatusResponse = typeof DataPlaneStatusResponseSchema.Type
export type InternalNetworkProfileResumeResponse =
  typeof InternalNetworkProfileResumeResponseSchema.Type
export type InternalNetworkProfileRejectResponse =
  typeof InternalNetworkProfileRejectResponseSchema.Type
