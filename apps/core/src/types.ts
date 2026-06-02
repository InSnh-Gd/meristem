import type {
  ActorId,
  AuditLog,
  AuditSearchQuery,
  BackfillParams,
  BackfillResult,
  CreateNodeTicketRequest,
  CreateNetworkRequest,
  DLQRecord,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  MNode,
  MNetwork,
  MNetworkMember,
  NodeAgentTaskExecuteResponse,
  NetworkSummary,
  Permission,
  PolicyDecision,
  ProjectionHealth,
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
 * 新增 OpenSearch 搜索方法。
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
  registerService(input: unknown): Promise<unknown>
  listServices(): Promise<unknown[]>
}


/**
 * ProjectionPort 暴露投影平台操作，Core 通过内部 HTTP 调用 M-Log 投影端点。

 */
export type ProjectionPort = {
  getHealth(): Promise<Result<ProjectionHealth[], ServiceError>>
  executeBackfill(params: BackfillParams): Promise<Result<BackfillResult, ServiceError>>
  listDLQ(index?: string): Promise<Result<DLQRecord[], ServiceError>>
  replayDLQ(dlqId: string): Promise<Result<boolean, ServiceError>>
  skipDLQ(dlqId: string): Promise<Result<boolean, ServiceError>>
}

/**
 * IdentityPort 收敛 Core 自持 actor 与 token 生命周期，避免外层直接接触身份表结构。
 */
export type IdentityPort = {
  listActors(): Promise<Result<Array<{ id: string; displayName: string; status: string; createdAt: string; updatedAt: string }>, ServiceError>>
  getActor(id: string): Promise<Result<{ id: string; displayName: string; status: string; createdAt: string; updatedAt: string } | null, ServiceError>>
  issueToken(input: { actor: string; ttl: string; purpose: string; correlationId: string }): Promise<Result<{ jti: string; token: string; expiresAt: string; actor: string }, ServiceError>>
  inspectToken(jti: string): Promise<Result<{ jti: string; actor: string; issuer: string; audience: string; issuedAt: string; expiresAt: string; issuedBy: string; purpose: string; status: string; revokedAt?: string; revokedBy?: string; revokeReason?: string } | null, ServiceError>>
  revokeToken(jti: string, input: { reason: string; correlationId: string }): Promise<Result<{ jti: string; status: string; revokedAt: string; revokedBy: string }, ServiceError>>
  introspect(jti: string): Promise<Result<{ active: boolean; actor?: string; jti?: string }, ServiceError>>
}

/**
 * SecretRefPort 仅暴露 metadata 与版本引用，禁止把明文 secret 泄漏给 Core 外部调用方。
 */
export type SecretRefPort = {
  list(): Promise<Result<Array<{ id: string; name: string; scope: string; status: string; createdBy: string; createdAt: string; metadata: Record<string, string> }>, ServiceError>>
  get(id: string): Promise<Result<{ id: string; name: string; scope: string; status: string; createdBy: string; createdAt: string; updatedAt: string; metadata: Record<string, string> } | null, ServiceError>>
  create(input: { name: string; scope: string; value: string; metadata?: Record<string, string>; correlationId: string }): Promise<Result<{ id: string; name: string; status: string; createdAt: string }, ServiceError>>
  rotate(id: string, input: { value: string; reason: string; correlationId: string }): Promise<Result<{ id: string; version: string; status: string; rotatedAt: string }, ServiceError>>
  disable(id: string, input: { reason: string; correlationId: string }): Promise<Result<{ id: string; status: string; disabledAt: string }, ServiceError>>
  reference(id: string): Promise<Result<{ id: string; currentVersion: string; status: string; metadata: Record<string, string> }, ServiceError>>
}

/**
 * ConfigPort 暴露配置草稿、校验、发布、回滚与 apply ack 生命周期，不让路由层操作内部状态机细节。
 */
export type ConfigPort = {
  list(): Promise<Result<Array<{ id: string; configVersion: string; domain: string; status: string; createdBy: string; createdAt: string }>, ServiceError>>
  get(id: string): Promise<Result<{ id: string; configVersion: string; schemaVersion: string; configHash: string; domain: string; targetScope: string[]; status: string; payload: unknown; createdBy: string; createdAt: string; publishedBy?: string; publishedAt?: string; rollbackVersion?: string; updatedAt: string } | null, ServiceError>>
  draft(input: { domain: string; payload: unknown; targetScope?: string[]; correlationId: string }): Promise<Result<{ id: string; configVersion: string; status: string; createdAt: string }, ServiceError>>
  validate(id: string): Promise<Result<{ id: string; status: string }, ServiceError>>
  publish(id: string, input: { reason: string; correlationId: string }): Promise<Result<{ id: string; configVersion: string; status: string; publishedAt: string; publishedBy: string }, ServiceError>>
  rollback(id: string, input: { toVersion: string; reason: string; correlationId: string }): Promise<Result<{ id: string; status: string }, ServiceError>>
  applyAck(id: string, input: { version: string; targetService: string; status: string; error?: string; correlationId: string }): Promise<Result<{ ackId: string; status: string; ackedAt: string }, ServiceError>>
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
  projection: ProjectionPort
  identity: IdentityPort
  secrets: SecretRefPort
  config: ConfigPort
  storage: CoreStorage
}
