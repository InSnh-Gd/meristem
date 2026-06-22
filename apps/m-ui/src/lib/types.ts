import type {
  ActorId,
  ApprovalActionResponse,
  ApprovalStatus,
  AuditLog,
  ApprovalDetailResponse as ContractApprovalDetailResponse,
  CoreDependencies,
  CoreMode,
  EventBusPublishMetricsSummaryFromSchema,
  MinimalPolicyDecisionSummaryFromSchema as MinimalPolicyDecisionSummary,
  MNetProfileRegion,
  MNetProfileVersion,
  MNetRegionalProfile,
  MNode,
  NetworkProfileState,
  NetworkSummary,
  OperationalCommandPreviewCommandIdFromSchema as OperationalCommandPreviewCommandId,
  Permission,
  PolicyApproval,
  PolicyDecision,
  ServiceInspectorResponseFromSchema as ServiceInspectorResponse,
  SduiV02RouteFromSchema as SduiV02Route,
  SduiV02RouteRegistryFromSchema as SduiV02RouteRegistry,
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

export type ServiceInspectorData = ServiceInspectorResponse

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

export type NetworkListResponseData = {
  networks: NetworkSummary[]
}

export type GlobalProfileSwitchState =
  | 'idle'
  | 'planned'
  | 'applying'
  | 'applied'
  | 'rolled_back'
  | 'failed'

export type GlobalDefaultsResponseData = WithStateSource<{
  defaultProfileVersion: string
  globalSwitchState: GlobalProfileSwitchState
  updatedAt: string
  switchOperationId?: string
}>

export type MigrationStatusResponseData = WithStateSource<{
  operationId: string
  globalSwitchState?: GlobalProfileSwitchState
  candidateCount?: number
  remainingBatches?: number
  nextBatchId?: number | null
}>

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

export type GenericCommandParams =
  | { leafNodeId: string }
  | { approvalId: string; reason?: string }
  | { networkId: string; profileVersion: string; reason?: string }
  | { profileVersion: string; reason?: string; idempotencyKey?: string }
  | {
      targetProfileVersion: string
      batchSize?: number
      reason?: string
      idempotencyKey?: string
    }
  | { operationId: string }
  | {
      requireApproval: boolean
      emergencyBreakGlassEnabled: boolean
      reason?: string
      idempotencyKey?: string
    }
  | { networkId: string; emergencyReason?: string }
  | { networkId: string; nodeId: string; reason?: string }
  | {
      networkId: string
      kind: string
      name: string
      capabilities?: string[]
      expiresInSeconds?: number
    }
  | { networkId: string; confirmation: string; emergencyReason?: string }
  | { operationId: string; reason?: string }

export type OverviewData = {
  session: { actor: ActorId; permissions: Permission[] }
  core: { id: string; version: string; mode: CoreMode }
  dependencies: CoreDependencies
  nodes: MNode[]
  services: ServiceSummary[]
  timeline: TimelineLog[]
  eventBusMetrics: EventBusPublishMetricsSummaryFromSchema | null
  auditAccessible: boolean
  audit: AuditEntry[] | null
}

// 单条 per-subject EventBus 发布指标项。
// 派生自 OverviewData 的本地 UI 别名，供 M-UI 组件在 BFF 契约边界消费，避免相对路径穿透到 packages/contracts。
export type EventBusSubjectMetric = NonNullable<OverviewData['eventBusMetrics']>['subjects'][number]

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

export type ApprovalCommandResult = ApprovalActionResponse & {
  correlationId?: string
}

export type ProfileCommandResult = {
  status: 'pending_approval' | 'disabled'
  correlationId: string
  operationId?: string
  approvalId?: string
  profileVersion?: string
}

export type PolicyDecisionSummary = MinimalPolicyDecisionSummary

export type AuditEntry = {
  id: string
  timestamp: string
  actor: string
  action: string
  resource: string
  result: string
}

export type BffJoinTicketRecord = {
  ticketId: string
  ticket: string
  expiresAt: string
  joinUrl: string
  policyDecisionId: string
  correlationId: string
  networkId: string
  status: 'active'
}

export type JoinTicketListResponseData = {
  tickets: BffJoinTicketRecord[]
}

export type BffDataPlaneNodeStatus = {
  networkId: string
  nodeId: string
  tunnelStatus: string
  relayAssignment: {
    relayId: string
    relayType: string
    relayEndpoint: string
  }
  lastMapVersion: string
  lastMapAt: string
  partitionState: string
  stateSource: StateSourceMetadata
}

export type DataPlaneStatusResponseData = {
  networkId: string
  nodes: BffDataPlaneNodeStatus[]
  stateSource: StateSourceMetadata
}

export type BffNetworkMapSummary = {
  networkId: string
  mapVersion: string
  memberCount: number
  aclRuleCount: number
  relayAssignment: {
    relayType: string
    relayEndpoint: string
    nodeIds: string[]
  }
  expiresAt: string
  signedBy: string
  stateSource: StateSourceMetadata
}

export type NetworkDetailResponseData = {
  network: WithStateSource<{
    id: string
    name: string
    profileVersion: string
    status: string
    createdAt: string
    memberCount?: number
  }>
  members: WithStateSource<{
    networkId: string
    nodeId: string
    nodeKind: string
    membershipMode: string
    status: string
    joinedAt: string
  }>[]
  profileState: {
    profileVersion: string
    stateSource: StateSourceMetadata
  }
  networkMapSummary: BffNetworkMapSummary
  dataPlaneStatus: DataPlaneStatusResponseData
  stateSource: StateSourceMetadata
}
