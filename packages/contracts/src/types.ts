import type { ActorId, Permission } from './literals.ts'
import type {
  CoreDependenciesFromSchema,
  CoreModeFromSchema,
  CreateNetworkResponseFromSchema,
  CreateNodeTicketResponseFromSchema,
  DependencyStateFromSchema,
  HealthResponseFromSchema,
  JoinNetworkResponseFromSchema,
  MNetworkFromSchema,
  MNetworkMemberFromSchema,
  NetworkMembershipModeFromSchema,
  NetworkMembershipStatusFromSchema,
  NetworkStatusFromSchema,
  NetworkSummaryFromSchema,
  NodeControlActionFromSchema,
  NodeKindFromSchema,
  NodeModeFromSchema,
  NodeReachabilityFromSchema,
  NodeStatusFromSchema,
  OperationDangerLevelFromSchema,
  PolicyResultFromSchema,
  ReadyResponseFromSchema,
  RiskFactorFromSchema,
  ServiceDomainFromSchema,
  ServiceKindFromSchema,
  ServiceLifecycleFromSchema,
  ServiceReloadResponseFromSchema,
  ServiceRuntimeModeFromSchema,
  SessionResponseFromSchema,
  StatusResponseFromSchema
} from './schemas/core.ts'
import type {
  ActorTokenV02FromSchema,
  IdentityActorStatusFromSchema,
  IdentityActorV02FromSchema,
  IdentityTokenStatusFromSchema,
  TokenIntrospectionResultFromSchema
} from './schemas/identity.ts'
import type { RedactedSecretRefFromSchema, SecretRefFromSchema } from './schemas/secret-provider.ts'
import type {
  MTaskStatusFromSchema,
  NodeAgentTaskExecuteResponseFromSchema,
  TaskPolicyResultFromSchema,
  TaskTypeFromSchema
} from './schemas/task.ts'

export type { ActorId, Permission } from './literals.ts'
export type {
  ConfigApplyAckV01,
  ConfigRecordV01,
  ConfigTransitionV01,
  ConfigVersionV01
} from './schemas/config.ts'
export type {
  IssueNodeCredentialResponse,
  RevokeNodeCredentialResponse
} from './types/core-node-credentials.ts'

// 与 schemas/* 存在孪生关系的契约一律以 `type X = XFromSchema` 别名引用 schema
// 作为结构源，消除手写孪生类型（模式先例：NodeAgentRedactedSecretRef）。
// 含可选属性的孪生结构（MNode/MTask/PolicyDecision/日志条目等）保留手写：
// Effect `Schema.optional` 的 Type 是 `prop?: T | undefined`，在
// exactOptionalPropertyTypes 下与 TypeBox 路由 schema 推导（`prop?: T`）不兼容。
export type DependencyState = DependencyStateFromSchema

export type NodeAgentRuntimeStatusKind = 'starting' | 'healthy' | 'degraded' | 'stopped' | 'failed'

export type NodeAgentDegradedReasonCode =
  | 'expired_credentials'
  | 'missing_signal'
  | 'missing_relay'
  | 'missing_stun'
  | 'sidecar_crash'
  | 'sidecar_start_failed'
  | 'config_drift'
  | 'secret_resolution_failed'
  | 'break_glass_stop'
  | 'profile_disabled'

export type NodeAgentRedactedSecretRef = RedactedSecretRefFromSchema

export type NodeAgentRuntimeDesiredSidecar = {
  signalConfigRef: { configRef: string }
  relayConfigRef: { configRef: string }
  stunConfigRef: { configRef: string }
  sidecarCredentialRef: SecretRefFromSchema
  desiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop'
  credentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  configHash?: string
}

export type NodeAgentRuntimeDependencyStatus = {
  signal: DependencyState
  relay: DependencyState
  stun: DependencyState
}

export type NodeAgentRuntimeDegradedReason = {
  code: NodeAgentDegradedReasonCode
  message: string
  detail?: string
}

export type NodeAgentRuntimeStatus = {
  kind: NodeAgentRuntimeStatusKind
  desiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop'
  credentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  configHash?: string
  sidecarConfigPath?: string
  processRef?: string
  correlationId: string
  observedAt: string
  dependencies: NodeAgentRuntimeDependencyStatus
  degradedReasons: NodeAgentRuntimeDegradedReason[]
  credentialRef?: NodeAgentRedactedSecretRef
}

// ReadyResponse 只报告当前 MVP 必需依赖，不把可选后端混进运行门禁。
export type CoreDependencyName = 'postgres' | 'nats' | 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'

export type CoreDependencies = CoreDependenciesFromSchema

export type ApiError = {
  error: {
    code: string
    message: string
    correlationId?: string
  }
}

// 服务摘要用于 service list、reload 和运行态聚合，不等同于完整 service definition。
export type CoreMode = CoreModeFromSchema
export type ServiceDomain = ServiceDomainFromSchema
export type ServiceKind = ServiceKindFromSchema
export type ServiceRuntimeMode = ServiceRuntimeModeFromSchema
export type ServiceLifecycle = ServiceLifecycleFromSchema
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

export type HealthResponse = HealthResponseFromSchema

// SessionResponse 让 UI/BFF 在不调用 M-Policy 的前提下获取当前操作者身份和权限列表。
export type SessionResponse = SessionResponseFromSchema

export type IdentityActorStatus = IdentityActorStatusFromSchema
export type IdentityTokenStatus = IdentityTokenStatusFromSchema

export type IdentityActorV02 = IdentityActorV02FromSchema

export type ActorTokenV02 = ActorTokenV02FromSchema

export type TokenIntrospectionResult = TokenIntrospectionResultFromSchema

// Ready 与 Health 明确分离：前者表示依赖可用性，后者只表示进程存活。
export type ReadyResponse = ReadyResponseFromSchema

export type StatusResponse = StatusResponseFromSchema

export type ServiceListResponse = {
  services: ServiceSummary[]
}

export type ServiceReloadRequest = {
  reason?: string
}

export type ServiceReloadResponse = ServiceReloadResponseFromSchema

// 节点运行态同时表达部署模式、可达性和生命周期状态。
export type NodeKind = NodeKindFromSchema
export type NodeMode = NodeModeFromSchema
export type NodeReachability = NodeReachabilityFromSchema
export type NodeStatus = NodeStatusFromSchema
export type NodeJoinTicketStatus = 'active' | 'redeemed' | 'expired' | 'revoked'
export type NodeControlAction = NodeControlActionFromSchema

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

export type NodeControlRequest = {
  action: NodeControlAction
  reason: string
  targetKind?: NodeKind
}

export type NodeControlResponse = {
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

export type CreateNodeTicketResponse = CreateNodeTicketResponseFromSchema

export type TaskType = TaskTypeFromSchema
export type MTaskStatus = MTaskStatusFromSchema
export type OperationDangerLevel = OperationDangerLevelFromSchema
export type RiskFactor = RiskFactorFromSchema

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

export type TaskPolicyResult = TaskPolicyResultFromSchema

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

export type NodeAgentTaskExecuteResponse = NodeAgentTaskExecuteResponseFromSchema

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
  runtimeStatus?: NodeAgentRuntimeStatus
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
export type NetworkStatus = NetworkStatusFromSchema
export type NetworkMembershipMode = NetworkMembershipModeFromSchema
export type NetworkMembershipStatus = NetworkMembershipStatusFromSchema

export type CreateNetworkRequest = {
  name: string
  profileVersion?: string
}

// 含可选 displayName 的孪生结构保留手写：Effect Schema.optional 的 Type 携带 `| undefined`，
// 在 exactOptionalPropertyTypes 下与 TypeBox 路由 schema 推导不兼容（见文件头注释）。
export type MNetwork = {
  id: string
  name: string
  displayName?: string
  profileVersion: string
  status: MNetworkFromSchema['status']
  createdAt: string
}

// 同 MNetwork：可选 displayName 的孪生结构保留手写，避免 Effect optional 的 `| undefined`
// 与 TypeBox schema 推导在 exactOptionalPropertyTypes 下冲突。
export type NetworkSummary = {
  id: string
  name: string
  displayName?: string
  profileVersion: string
  status: NetworkSummaryFromSchema['status']
  createdAt: string
  memberCount: number
}

export type CreateNetworkResponse = CreateNetworkResponseFromSchema

export type JoinNetworkRequest = {
  nodeId: string
}

export type MNetworkMember = MNetworkMemberFromSchema

export type JoinNetworkResponse = JoinNetworkResponseFromSchema

export type PolicyResult = PolicyResultFromSchema

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
