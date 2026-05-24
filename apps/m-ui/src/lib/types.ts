import type {
  ActorId, CoreDependencies, CoreMode, MNode, Permission,
  ServiceSummary, TimelineLog
} from '../../../packages/contracts/src/index.ts'

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

export type TaskResult = {
  task: {
    id: string
    nodeId: string
    leafNodeId: string
    type: string
    status: string
    createdAt: string
    updatedAt: string
    completedAt?: string
  }
  policyDecisionId: string
  correlationId: string
}

export type PolicyDecisionSummary = {
  id: string
  actor: string
  action: string
  resource: string
  result: string
  createdAt: string
}

export type AuditEntry = {
  id: string
  timestamp: string
  actor: string
  action: string
  resource: string
  result: string
}
