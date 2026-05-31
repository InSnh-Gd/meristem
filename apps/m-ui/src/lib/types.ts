import type {
  ActorId, AuditLog, CoreDependencies, CoreMode, MinimalPolicyDecisionSummary,
  MNode, Permission, PolicyDecision, ServiceSummary, SubmitTaskResponse, TimelineLog,
  SduiV02Route, SduiV02RouteRegistry
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
