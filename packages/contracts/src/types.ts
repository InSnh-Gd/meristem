import type { ActorId, Permission } from './literals.ts'

export type { ActorId, Permission } from './literals.ts'

export type DependencyState = 'ready' | 'unavailable'

// ReadyResponse 只报告当前 MVP 必需依赖，不把可选后端混进运行门禁。
export type CoreDependencyName =
  | 'postgres'
  | 'nats'
  | 'm-policy'
  | 'm-log'
  | 'm-eventbus'
  | 'm-net'

export type CoreDependencies = Record<CoreDependencyName, DependencyState>

export type ApiError = {
  error: {
    code: string
    message: string
    correlationId?: string
  }
}

// 服务摘要用于 service list、reload 和运行态聚合，不等同于完整 service definition。
export type CoreMode = 'normal' | 'degraded' | 'safe'
export type ServiceDomain = 'core' | 'm-net' | 'm-eventbus' | 'm-log' | 'm-policy' | 'm-ui' | 'm-cli' | 'm-extension'
export type ServiceKind = 'core' | 'internal' | 'node' | 'task' | 'extension' | 'bff'
export type ServiceRuntimeMode = 'normal' | 'degraded'
export type ServiceLifecycle = {
  reloadable: boolean
  rollbackable: boolean
  degradable: boolean
}
export type ServiceRuntime = {
  liveness: boolean
  readiness: boolean
  mode: ServiceRuntimeMode
  lastError?: string
  lastReloadedAt?: string
}
export type ServiceSummary = {
  id: string
  version: string
  domain: ServiceDomain
  kind: ServiceKind
  lifecycle: ServiceLifecycle
  runtime?: ServiceRuntime
}

export type HealthResponse = {
  ok: true
  service: 'meristem-core'
  version: string
  uptimeMs: number
}

// SessionResponse 让 UI/BFF 在不调用 M-Policy 的前提下获取当前操作者身份和权限列表。
export type SessionResponse = {
  actor: ActorId
  permissions: Permission[]
}

// Ready 与 Health 明确分离：前者表示依赖可用性，后者只表示进程存活。
export type ReadyResponse = {
  ready: boolean
  dependencies: CoreDependencies
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

export type ServiceListResponse = {
  services: ServiceSummary[]
}

export type ServiceReloadRequest = {
  reason?: string
}

export type ServiceReloadResponse = {
  serviceId: string
  accepted: true
  reloadedAt: string
  policyDecisionId: string
  correlationId: string
}

// 节点运行态从 Phase 8 开始同时表达部署模式、可达性和生命周期状态。
export type NodeKind = 'stem' | 'leaf'
export type NodeMode = 'agent' | 'simulated'
export type NodeReachability = 'unknown' | 'reachable' | 'unreachable'
export type NodeStatus = 'joining' | 'healthy' | 'degraded' | 'offline' | 'revoked'
export type NodeJoinTicketStatus = 'active' | 'redeemed' | 'expired' | 'revoked'

export type RegisterNodeRequest = {
  kind: NodeKind
  name: string
  mode?: Extract<NodeMode, 'simulated'>
  capabilities?: string[]
}

export type MNode = {
  id: string
  kind: NodeKind
  name: string
  mode: NodeMode
  status: NodeStatus
  reachability: NodeReachability
  lastSeenAt?: string
  agentVersion?: string
  capabilities: string[]
  createdAt: string
}

export type RegisterNodeResponse = {
  node: MNode
  policyDecisionId: string
  correlationId: string
}

export type CreateNodeTicketRequest = {
  kind: NodeKind
  name: string
  capabilities?: string[]
  expiresInSeconds?: number
}

export type CreateNodeTicketResponse = {
  ticketId: string
  ticket: string
  expiresAt: string
  joinUrl: string
  policyDecisionId: string
  correlationId: string
}

export type IssueNodeCredentialResponse = {
  nodeId: string
  token: string
  issuedAt: string
  policyDecisionId: string
  correlationId: string
}

// 当前任务模型刻意收敛为 noop，用来验证控制面和 agent bus 的最小闭环。
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

export type NodeAgentTaskExecuteRequest = {
  nodeId: string
  taskId: string
  type: 'noop'
  correlationId?: string
}

export type NodeAgentTaskExecuteResponse = {
  nodeId: string
  taskId: string
  result: 'completed'
  completedAt: string
}

// Phase 8 steady-state frames are session-scoped: only the handshake carries runtime secrets.
export type JoinRedeemMessage = {
  type: 'join.redeem'
  ticket: string
}

export type SessionResumeMessage = {
  type: 'session.resume'
  nodeId: string
  token: string
}

export type SessionHeartbeatMessage = {
  type: 'heartbeat'
  sessionId: string
  agentVersion: string
  reportedStatus: 'healthy' | 'degraded'
  timestamp: string
}

export type SessionLogForwardMessage = {
  type: 'log.forward'
  sessionId: string
  level: FullLog['level']
  message: string
  timestamp: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}

export type SessionTaskResultMessage = {
  type: 'task.result'
  sessionId: string
  taskId: string
  result: 'completed'
  completedAt: string
}

export type MNetSessionClientMessage =
  | JoinRedeemMessage
  | SessionResumeMessage
  | SessionHeartbeatMessage
  | SessionLogForwardMessage
  | SessionTaskResultMessage

export type JoinAcceptedMessage = {
  type: 'join.accepted'
  sessionId: string
  node: MNode
  runtimeToken: string
  issuedAt: string
}

export type SessionResumedMessage = {
  type: 'session.resumed'
  sessionId: string
  node: MNode
}

export type SessionTaskExecuteMessage = {
  type: 'task.execute'
  nodeId: string
  taskId: string
  taskType: 'noop'
  correlationId: string
}

export type SessionErrorMessage = {
  type: 'error'
  code: string
  message: string
}

export type MNetSessionServerMessage =
  | JoinAcceptedMessage
  | SessionResumedMessage
  | SessionTaskExecuteMessage
  | SessionErrorMessage

// 逻辑网络阶段只表达成员关系，不宣称真实传输路径或 P2P 能力。
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

// 三层日志事实共享同一组基础字段，但语义和权限要求完全不同。
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

// Phase 10 OpenSearch 搜索契约类型，来自 MERISTEM-ROADMAP.md §3.11 与 docs/roadmap/PHASE-10.md §6
export type LogSearchQuery = {
  q?: string
  from?: string
  to?: string
  limit?: number
}

export type FullLogSearchQuery = LogSearchQuery & {
  level?: 'debug' | 'info' | 'warn' | 'error'
  source?: string
  correlationId?: string
  traceId?: string
}

export type TimelineSearchQuery = LogSearchQuery & {
  subject?: string
  correlationId?: string
}

export type AuditSearchQuery = LogSearchQuery & {
  actor?: string
  action?: string
  resource?: string
  decisionId?: string
  correlationId?: string
}

// 搜索结果统一包装，Phase 10.0 不实现 cursor pagination
export type LogSearchResult<T> = {
  entries: T[]
  total: number
}

// ---- Phase 10.1 Projection Platform 类型 ----
// 来源：docs/roadmap/PHASE-10.1.md

// §2.1 Projector Job 状态机：pending → running → completed | failed | cancelled
export type ProjectorJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ProjectorJobType = 'backfill' | 'incremental' | 'repair'

export type ProjectorJob = {
  id: string
  type: ProjectorJobType
  index: string
  startCursor: ProjectionCursor | null
  endCursor: ProjectionCursor | null
  batchSize: number
  status: ProjectorJobStatus
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

// §2.3 Cursor 形状：基于 PostgreSQL 事实表的 (id, timestamp) 排序
export type ProjectionCursor = {
  factId: string
  timestamp: string // ISO8601
}

// §2.4 DLQ 记录 schema
export type DLQRecord = {
  id: string
  jobId: string
  factId: string
  index: string
  error: string
  attemptedAt: string[] // ISO8601 timestamps per retry
  retries: number
  createdAt: string
}

// §2.6 投影健康指标
export type ProjectionHealth = {
  index: string
  lagSeconds: number
  lastProjectedAt: string | null
  pendingCount: number
  dlqCount: number
  status: 'healthy' | 'degraded' | 'unavailable'
}

// §2.5 Backfill 参数
export type BackfillParams = {
  index: string
  from: ProjectionCursor | null
  to: ProjectionCursor | null
  batchSize: number
  targetVersion?: string // 目标索引版本，默认 latest
}

// Backfill 结果
export type BackfillResult = {
  jobId: string
  processedCount: number
  errors: number
  lastCursor: ProjectionCursor | null
  status: ProjectorJobStatus
}
