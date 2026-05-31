import type { ActorId } from '../literals.ts'

export type MNetProfileVersion = 'm-net-cn@0.1.0' | 'm-net-default@0.1.0'

export type MNetProfileRegion = 'cn' | 'default'

export type MNetRegionalProfile = {
  profileVersion: MNetProfileVersion
  region: MNetProfileRegion
  displayName: string
  schemaVersion: 'mnet-profile@0.1.0'
  status: 'available' | 'deprecated'
  rules: Record<string, unknown>
  capabilities: {
    realDerpRelay: false
    realTcpInterconnect: false
    realUdpPathSwitching: false
    controlPlaneOnly: boolean
  }
}

export type SetNetworkProfileRequest = {
  profileVersion: MNetProfileVersion
  reason: string
}

export type NetworkProfileState = 'disabled' | 'enabling' | 'enabled' | 'disabling' | 'failed'

export type NetworkProfileSummary = {
  networkId: string
  profileVersion: MNetProfileVersion
  status: NetworkProfileState
  enabledBy?: ActorId
  policyDecisionId?: string
  correlationId?: string
  appliedAt?: string
  disabledAt?: string
  lastError?: string
  updatedAt: string
}

export type NetworkSuspendedOperationStatus = 'suspended' | 'resumed' | 'rejected' | 'expired' | 'resume_failed'

export type NetworkSuspendedOperation = {
  id: string
  policyDecisionId: string
  action: 'mnet.profile.enable'
  networkId: string
  fromProfileVersion: MNetProfileVersion
  toProfileVersion: MNetProfileVersion
  requestedBy: ActorId
  reason: string
  correlationId: string
  idempotencyKey: string
  status: NetworkSuspendedOperationStatus
  expiresAt: string
  createdAt: string
  resumedAt?: string
  terminalReason?: string
}

export type MNetProfileEventSubject =
  | 'mnet.profile.enable.requested.v0'
  | 'mnet.profile.enabled.v0'
  | 'mnet.profile.disable.requested.v0'
  | 'mnet.profile.disabled.v0'
  | 'mnet.profile.apply_failed.v0'
  | 'mnet.profile.enable.canceled.v0'

export type MNetProfileEventPayload = {
  networkId: string
  fromProfileVersion: MNetProfileVersion
  toProfileVersion: MNetProfileVersion
  actor: ActorId
  policyDecisionId: string
  approvalId?: string
  operationId?: string
  correlationId: string
  reason: string
  controlPlaneOnly: true
}

export type MNetProfileEnableRequestedEventPayload = MNetProfileEventPayload
export type MNetProfileEnabledEventPayload = MNetProfileEventPayload
export type MNetProfileDisableRequestedEventPayload = MNetProfileEventPayload
export type MNetProfileDisabledEventPayload = MNetProfileEventPayload
export type MNetProfileApplyFailedEventPayload = MNetProfileEventPayload
export type MNetProfileEnableCanceledEventPayload = MNetProfileEventPayload
