export type ActorId = 'viewer' | 'operator' | 'admin' | 'security-admin'

export type Permission =
  | 'core:read'
  | 'node:register'
  | 'task:assign'
  | 'timeline:read'
  | 'log:read-full'
  | 'audit:read'
  | 'service:register'
  | 'network:read'
  | 'network:create'
  | 'network:join'

export type DependencyState = 'ready' | 'unavailable'

export type ApiError = {
  error: {
    code: string
    message: string
    correlationId?: string
  }
}

export type CoreMode = 'normal' | 'degraded' | 'safe'

export type HealthResponse = {
  ok: true
  service: 'meristem-core'
  version: string
  uptimeMs: number
}

export type ReadyResponse = {
  ready: boolean
  dependencies: {
    postgres: DependencyState
    nats: DependencyState
  }
}

export type StatusResponse = {
  core: {
    id: string
    version: string
    mode: CoreMode
  }
  dependencies: ReadyResponse['dependencies']
  counts: {
    services: number
    nodes: number
    tasks: number
  }
}

export type NodeKind = 'stem' | 'leaf'
export type NodeStatus = 'joining' | 'healthy' | 'degraded' | 'offline' | 'revoked'

export type RegisterNodeRequest = {
  kind: NodeKind
  name: string
  capabilities?: string[]
}

export type MNode = {
  id: string
  kind: NodeKind
  name: string
  status: NodeStatus
  capabilities: string[]
  createdAt: string
}

export type RegisterNodeResponse = {
  node: MNode
  policyDecisionId: string
  correlationId: string
}

export type AssignTaskRequest = {
  leafNodeId: string
  type: 'noop'
}

export type MTask = {
  id: string
  leafNodeId: string
  type: 'noop'
  status: 'requested' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
}

export type AssignTaskResponse = {
  task: MTask
  policyDecisionId: string
  correlationId: string
}

export type NetworkStatus = 'active'
export type NetworkMembershipMode = 'full' | 'restricted'
export type NetworkMembershipStatus = 'joined'

export type CreateNetworkRequest = {
  name: string
  profileVersion?: string
}

export type MNetwork = {
  id: string
  name: string
  profileVersion: string
  status: NetworkStatus
  createdAt: string
}

export type NetworkSummary = MNetwork & {
  memberCount: number
}

export type CreateNetworkResponse = {
  network: MNetwork
  policyDecisionId: string
  correlationId: string
}

export type JoinNetworkRequest = {
  nodeId: string
}

export type MNetworkMember = {
  networkId: string
  nodeId: string
  nodeKind: NodeKind
  membershipMode: NetworkMembershipMode
  status: NetworkMembershipStatus
  joinedAt: string
}

export type JoinNetworkResponse = {
  member: MNetworkMember
  policyDecisionId: string
  correlationId: string
}

export type PolicyResult = 'allow' | 'deny'

export type PolicyDecision = {
  id: string
  actor: ActorId
  action: Permission
  resource: string
  result: PolicyResult
  reasons: string[]
  createdAt: string
}

export type TimelineLog = {
  id: string
  timestamp: string
  summary: string
  subject?: string
  correlationId?: string
}

export type FullLog = {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}

export type AuditLog = {
  id: string
  timestamp: string
  actor: ActorId | 'system'
  action: string
  resource: string
  decisionId?: string
  result: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}
