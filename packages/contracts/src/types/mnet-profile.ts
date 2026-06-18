import type {
  DataPlaneStatusResponseSchema,
  InternalNetworkProfileRejectResponseSchema,
  InternalNetworkProfileResumeResponseSchema,
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
  MNetProfileListResponseSchema,
  MNetProfileRegionSchema,
  MNetProfileSchemaVersionSchema,
  MNetProfileVersionSchema,
  MNetReachabilityChangedEventPayloadSchema,
  MNetRegionalProfileCapabilitiesSchema,
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

export type MNetProfileVersion = typeof MNetProfileVersionSchema.Type
export type MNetProfileRegion = typeof MNetProfileRegionSchema.Type
export type MNetProfileSchemaVersion = typeof MNetProfileSchemaVersionSchema.Type
export type MNetRegionalProfileCapabilities = typeof MNetRegionalProfileCapabilitiesSchema.Type
export type MNetRegionalProfile = typeof MNetRegionalProfileSchema.Type

export type SetNetworkProfileRequest = typeof SetNetworkProfileRequestSchema.Type

export type NetworkProfileState = typeof NetworkProfileStateSchema.Type
export type NetworkProfileSummary = typeof NetworkProfileSummarySchema.Type

export type NetworkSuspendedOperationStatus = typeof NetworkSuspendedOperationStatusSchema.Type
type MutableSchemaType<T> = { -readonly [K in keyof T]: T[K] }
export type NetworkSuspendedOperation = MutableSchemaType<
  typeof NetworkSuspendedOperationSchema.Type
>

export type MNetProfileEventSubject = typeof MNetProfileEventSubjectSchema.Type
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
