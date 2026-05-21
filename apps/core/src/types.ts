import type {
  ActorId,
  AssignTaskRequest,
  AuditLog,
  AuditSearchQuery,
  CreateNodeTicketRequest,
  CreateNetworkRequest,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  MNode,
  MNetwork,
  MNetworkMember,
  NodeAgentTaskExecuteResponse,
  NetworkSummary,
  MTask,
  Permission,
  PolicyDecision,
  ReadyResponse,
  RegisterNodeRequest,
  ServiceSummary,
  SessionResponse,
  TimelineLog,
  TimelineSearchQuery
} from '../../../packages/contracts/src/index.ts'
import type { MEventEnvelope } from '../../../packages/events/src/index.ts'
import type { Result } from '../../../packages/common/src/result.ts'

/**
 * Core 只依赖统一的服务错误形状，不把各子服务的内部异常类型泄漏到边界层。
 */
export type ServiceError = {
  code: string
  message: string
}

/**
 * AuthPort 只负责认证，不在这里叠加 RBAC，以保持认证和授权职责分离。
 */
export type AuthPort = {
  verify(token: string): Promise<Result<{ actor: ActorId }, ServiceError> | { ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
  getPermissions(actor: ActorId): Promise<Result<Permission[], ServiceError>>
}

/**
 * PolicyPort 对应 Core 的最小授权入口，所有高权限操作都必须显式经过这里。
 */
export type PolicyPort = {
  authorize(input: {
    actor: ActorId
    action: Permission
    resource: string
    correlationId: string
  }): Promise<Result<PolicyDecision, ServiceError>>
  getDecision(id: string): Promise<Result<PolicyDecision | null, ServiceError>>
}

/**
 * LogPort 固定提供 Timeline / Full / Audit 三层日志接口，防止调用方绕开分级语义。
 * Phase 10 新增 OpenSearch 搜索方法。
 */
export type LogPort = {
  writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>): Promise<Result<TimelineLog, ServiceError>>
  writeFull(input: Omit<FullLog, 'id' | 'timestamp'>): Promise<Result<FullLog, ServiceError>>
  writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>): Promise<Result<AuditLog, ServiceError>>
  listTimeline(limit?: number): Promise<Result<TimelineLog[], ServiceError>>
  listFull(limit?: number): Promise<Result<FullLog[], ServiceError>>
  listAudit(limit?: number): Promise<Result<AuditLog[], ServiceError>>
  searchFull(query: FullLogSearchQuery): Promise<Result<LogSearchResult<FullLog>, ServiceError>>
  searchTimeline(query: TimelineSearchQuery): Promise<Result<LogSearchResult<TimelineLog>, ServiceError>>
  searchAudit(query: AuditSearchQuery): Promise<Result<LogSearchResult<AuditLog>, ServiceError>>
}

/**
 * EventPort 只抽象"发布成功或失败"，不把具体总线实现泄漏给 Core 路由。
 */
export type EventPort = {
  publish(subject: string, event: MEventEnvelope): Promise<Result<{ eventId: string }, ServiceError>>
}

/**
 * MNetPort 暴露逻辑组网的最小能力，真实传输能力仍由后续阶段单独扩展。
 */
export type MNetPort = {
  createNetwork(input: CreateNetworkRequest): Promise<Result<MNetwork, ServiceError>>
  listNetworks(): Promise<Result<NetworkSummary[], ServiceError>>
  joinNetwork(input: { networkId: string; nodeId: string }): Promise<Result<MNetworkMember, ServiceError>>
  listNetworkMembers(networkId: string): Promise<Result<MNetworkMember[], ServiceError>>
}

/**
 * AgentTaskPort 隔离"下发到 node-agent 并等待完成"的边界，避免 task 路由直接操作 NATS。
 */
export type AgentTaskPort = {
  executeNoop(input: { nodeId: string; taskId: string; correlationId: string }): Promise<Result<NodeAgentTaskExecuteResponse, ServiceError>>
}

/**
 * ServiceLifecyclePort 收敛服务运行态和 reload 控制，避免 Core 直接依赖具体子服务实现细节。
 */
export type ServiceLifecyclePort = {
  list(): Promise<Result<ServiceSummary[], ServiceError>>
  reload(input: { serviceId: string; correlationId: string; reason?: string }): Promise<Result<{ serviceId: string; reloadedAt: string }, ServiceError>>
}

/**
 * CoreStorage 代表 PostgreSQL 权威写模型边界；事件、日志和缓存都不能替代这里的职责。
 */
export type CoreStorage = {
  readiness(): Promise<ReadyResponse['dependencies']>
  counts(): Promise<{ services: number; nodes: number; tasks: number }>
  registerNode(input: RegisterNodeRequest): Promise<MNode>
  createNodeTicket(input: CreateNodeTicketRequest & { createdBy: ActorId }): Promise<{
    ticketId: string
    ticket: string
    expiresAt: string
  }>
  issueNodeCredential(nodeId: string): Promise<{ nodeId: string; token: string; issuedAt: string } | null>
  hasActiveNodeCredential(nodeId: string): Promise<boolean>
  validateNodeCredential(nodeId: string, token: string): Promise<boolean>
  listNodes(): Promise<MNode[]>
  getNode(id: string): Promise<MNode | null>
  assignTask(input: AssignTaskRequest): Promise<MTask>
  createTaskRequest(input: AssignTaskRequest): Promise<MTask>
  completeTask(input: { taskId: string; completedAt: string }): Promise<MTask | null>
  getTask(id: string): Promise<MTask | null>
  registerService(input: unknown): Promise<unknown>
  listServices(): Promise<unknown[]>
}

/**
 * CoreDeps 是微内核真正依赖的端口集合，路由层必须通过这些显式端口访问外部能力。
 */
export type CoreDeps = {
  startedAt: number
  version: string
  joinIngressPublicUrl: string
  auth: AuthPort
  policy: PolicyPort
  log: LogPort
  events: EventPort
  mNet: MNetPort
  agentTasks: AgentTaskPort
  services: ServiceLifecyclePort
  storage: CoreStorage
}
