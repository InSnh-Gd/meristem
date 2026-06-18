import type { ActorId, Permission } from './literals.ts'

export type { ActorId, Permission } from './literals.ts'
export type {
  ConfigApplyAckV01,
  ConfigRecordV01,
  ConfigTransitionV01,
  ConfigVersionV01
} from './schemas/config.ts'
export type {
  SecretRefTransitionV01,
  SecretRefV01,
  SecretRefVersionV01
} from './schemas/secrets.ts'

export type DependencyState = 'ready' | 'unavailable'

// ReadyResponse 只报告当前 MVP 必需依赖，不把可选后端混进运行门禁。
export type CoreDependencyName = 'postgres' | 'nats' | 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'

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
export type ServiceDomain =
  | 'core'
  | 'm-net'
  | 'm-eventbus'
  | 'm-log'
  | 'm-policy'
  | 'm-task'
  | 'm-ui'
  | 'm-cli'
  | 'm-extension'
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

export type IdentityActorStatus = 'active' | 'disabled'
export type IdentityTokenStatus = 'active' | 'revoked' | 'expired'

export interface IdentityActorV02 {
  readonly id: 'viewer' | 'operator' | 'admin' | 'security-admin'
  readonly displayName: string
  readonly status: IdentityActorStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ActorTokenV02 {
  readonly jti: string
  readonly actor: IdentityActorV02['id']
  readonly issuer: 'meristem-local'
  readonly audience: 'meristem-core' | 'meristem-service'
  readonly issuedAt: string
  readonly expiresAt: string
  readonly issuedBy: IdentityActorV02['id']
  readonly purpose: string
  readonly status: IdentityTokenStatus
  readonly revokedAt?: string
  readonly revokedBy?: IdentityActorV02['id']
  readonly revokeReason?: string
}

export interface TokenIntrospectionResult {
  readonly active: boolean
  readonly actor?: IdentityActorV02['id']
  readonly jti?: string
  readonly status?: IdentityTokenStatus
  readonly expiresAt?: string
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

// 节点运行态同时表达部署模式、可达性和生命周期状态。
export type NodeKind = 'stem' | 'leaf'
export type NodeMode = 'agent' | 'managed' | 'simulated'
export type NodeReachability = 'unknown' | 'public' | 'private' | 'reachable' | 'unreachable'
export type NodeStatus = 'ready' | 'joining' | 'healthy' | 'degraded' | 'offline' | 'revoked'
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

export type TaskType = 'noop'
export type MTaskStatus =
  | 'accepted'
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'
  | 'timed_out'
export type OperationDangerLevel = 'low' | 'medium' | 'high' | 'critical'
export type RiskFactor =
  | 'actor_permission_level'
  | 'operation_danger_level'
  | 'target_node_kind'
  | 'target_node_reachability'
  | 'task_type_risk'
  | 'recent_failure_count'
  | 'outside_expected_scope'
  | 'audit_visibility'

// M-Task 拥有 canonical task lifecycle。
export type SubmitTaskRequest = {
  nodeId: string
  type: TaskType
  timeoutAt?: string
}

export type MTask = {
  id: string
  nodeId: string
  leafNodeId: string
  type: TaskType
  status: MTaskStatus
  createdAt: string
  updatedAt: string
  timeoutAt?: string
  completedAt?: string
  canceledAt?: string
}

export type TaskRiskSummary = {
  operationDangerLevel: OperationDangerLevel
  suspicionScore: number
  riskFactors: RiskFactor[]
}

export type TaskPolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

export type MTaskPolicyDecision = {
  decisionId: string
  result: TaskPolicyResult
  requiredAction?: 'manual_review' | 'multi_approval' | undefined
  reasons: string[]
}

export type SubmitTaskResponse = {
  task: MTask
  policyDecisionId: string
  correlationId: string
  risk: TaskRiskSummary
}

export type TaskListResponse = {
  tasks: MTask[]
}

export type TaskStatusResponse = {
  task: MTask
}

export type TaskControlResponse = {
  task: MTask
  policyDecisionId: string
  correlationId: string
  risk: TaskRiskSummary
}

export type TaskRetryNotImplementedResponse = {
  error: {
    code: 'not_implemented_yet'
    message: string
  }
  decisionId: string
  risk: TaskRiskSummary
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

// Steady-state frames are session-scoped: only the handshake carries runtime secrets.
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

export type PolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

export type PolicyDecision = {
  id: string
  actor: ActorId
  action: Permission
  resource: string
  result: PolicyResult
  reasons: string[]
  operationDangerLevel?: OperationDangerLevel
  suspicionScore?: number
  riskFactors?: RiskFactor[]
  requiredAction?: 'manual_review' | 'multi_approval'
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
