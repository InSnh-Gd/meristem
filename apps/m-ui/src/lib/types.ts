import type {
  ApprovalDetailResponse as ContractApprovalDetailResponse,
  ApprovalStatus,
  ActorId,
  AuditLog,
  CoreDependencies,
  CoreMode,
  MNetRegionalProfile,
  MNetProfileRegion,
  MNetProfileVersion,
  MinimalPolicyDecisionSummary,
  MNode,
  NetworkProfileState,
  OperationalCommandPreviewCommandId,
  Permission,
  PolicyApproval,
  PolicyDecision,
  SduiV02Route,
  SduiV02RouteRegistry,
  ServiceSummary,
  SubmitTaskResponse,
  TimelineLog
} from '../../../../packages/contracts/src/index.ts'

export type StateSourceMetadata = {
  sourceType: 'authoritative' | 'event' | 'cache' | 'read-model' | 'log' | 'audit' | 'policy'
  sourceId: string
  correlationId?: string
  traceId?: string
}

export type WithStateSource<T extends object> = T & { stateSource: StateSourceMetadata }

export type RouteDefinition = SduiV02Route

export type RouteRegistry = SduiV02RouteRegistry

export type NodeListData = {
  nodes: Array<WithStateSource<MNode>>
  stateSource: StateSourceMetadata
}

export type TimelineData = {
  entries: Array<WithStateSource<TimelineLog>>
  stateSource: StateSourceMetadata
}

export type AuditData = {
  entries: Array<WithStateSource<AuditLog>>
  stateSource: StateSourceMetadata
}

export type PolicyDecisionData = {
  decisions: Array<WithStateSource<PolicyDecision>>
  stateSource: StateSourceMetadata
}

export type ServiceListData = {
  services: Array<WithStateSource<ServiceSummary>>
  stateSource: StateSourceMetadata
}

export type ApprovalQueueResponseData = {
  approvals: Array<WithStateSource<PolicyApproval>>
  stateSource: StateSourceMetadata
}

export type ApprovalDetailResponseData = WithStateSource<ContractApprovalDetailResponse>

export type NetworkProfileListResponseData = {
  profiles: Array<WithStateSource<MNetRegionalProfile>>
  stateSource: StateSourceMetadata
}

export type NetworkProfileDetailResponseData = WithStateSource<MNetRegionalProfile>

export interface ApprovalDisplayItem {
  approvalId: string
  policyDecisionId: string
  originService: string
  operationId: string
  requestedBy: ActorId
  requiredAction: 'manual_review' | 'multi_approval'
  quorumRequired: number
  status: ApprovalStatus
  expiresAt: string
  createdAt: string
  completedAt?: string
  stateSource: StateSourceMetadata
}

export interface ApprovalVoteItem {
  actor: ActorId
  vote: 'approve' | 'reject'
  reason?: string
  createdAt: string
  stateSource: StateSourceMetadata
}

export type ApprovalQueueData = {
  approvals: ApprovalDisplayItem[]
  stateSource: StateSourceMetadata
}

export interface ApprovalDetailData extends ApprovalDisplayItem {
  votes: ApprovalVoteItem[]
}

export interface ProfileListItem {
  profileVersion: MNetProfileVersion
  region: MNetProfileRegion
  displayName: string
  controlPlaneOnly: boolean
  status: NetworkProfileState | 'available' | 'deprecated'
  networkId?: string
  stateSource: StateSourceMetadata
}

export type NetworkProfileListData = {
  profiles: ProfileListItem[]
  stateSource: StateSourceMetadata
}

export interface CommandPreviewResult {
  commandId: OperationalCommandPreviewCommandId
  displayOnly: true
  state: 'enabled' | 'disabled'
  disabledReason?: string
}

export type GenericCommandParams = {
  leafNodeId: string
}

export type OverviewData = {
  session: { actor: ActorId; permissions: Permission[] }
  core: { id: string; version: string; mode: CoreMode }
  dependencies: CoreDependencies
  nodes: MNode[]
  services: ServiceSummary[]
  timeline: TimelineLog[]
  auditAccessible: boolean
  audit: AuditEntry[] | null
}

export type CommandState = {
  state: 'enabled' | 'disabled'
  disabledReason?: string
  command?: {
    id: string
    label: string
    action: string
    resource: string
    risk: string
    requiredPermissions: string[]
    requiresPolicy: boolean
    requiresAudit: boolean
  }
}

export type TaskResult = SubmitTaskResponse

export type PolicyDecisionSummary = MinimalPolicyDecisionSummary

export type AuditEntry = {
  id: string
  timestamp: string
  actor: string
  action: string
  resource: string
  result: string
}
