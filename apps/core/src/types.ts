import type {
  ActorId,
  AssignTaskRequest,
  AuditLog,
  CreateNetworkRequest,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  MTask,
  Permission,
  PolicyDecision,
  ReadyResponse,
  RegisterNodeRequest,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import type { MEventEnvelope } from '../../../packages/events/src/index.ts'
import type { Result } from '../../../packages/common/src/result.ts'

export type ServiceError = {
  code: string
  message: string
}

export type AuthPort = {
  verify(token: string): Promise<Result<{ actor: ActorId }, ServiceError> | { ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
}

export type PolicyPort = {
  authorize(input: {
    actor: ActorId
    action: Permission
    resource: string
    correlationId: string
  }): Promise<Result<PolicyDecision, ServiceError>>
  getDecision(id: string): Promise<Result<PolicyDecision | null, ServiceError>>
}

export type LogPort = {
  writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>): Promise<Result<TimelineLog, ServiceError>>
  writeFull(input: Omit<FullLog, 'id' | 'timestamp'>): Promise<Result<FullLog, ServiceError>>
  writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>): Promise<Result<AuditLog, ServiceError>>
  listTimeline(limit?: number): Promise<Result<TimelineLog[], ServiceError>>
  listFull(limit?: number): Promise<Result<FullLog[], ServiceError>>
  listAudit(limit?: number): Promise<Result<AuditLog[], ServiceError>>
}

export type EventPort = {
  publish(subject: string, event: MEventEnvelope): Promise<Result<{ eventId: string }, ServiceError>>
}

export type MNetPort = {
  createNetwork(input: CreateNetworkRequest): Promise<Result<MNetwork, ServiceError>>
  listNetworks(): Promise<Result<NetworkSummary[], ServiceError>>
  joinNetwork(input: { networkId: string; nodeId: string }): Promise<Result<MNetworkMember, ServiceError>>
  listNetworkMembers(networkId: string): Promise<Result<MNetworkMember[], ServiceError>>
}

export type CoreStorage = {
  readiness(): Promise<ReadyResponse['dependencies']>
  counts(): Promise<{ services: number; nodes: number; tasks: number }>
  registerNode(input: RegisterNodeRequest): Promise<MNode>
  listNodes(): Promise<MNode[]>
  getNode(id: string): Promise<MNode | null>
  assignTask(input: AssignTaskRequest): Promise<MTask>
  getTask(id: string): Promise<MTask | null>
  registerService(input: unknown): Promise<unknown>
  listServices(): Promise<unknown[]>
}

export type CoreDeps = {
  startedAt: number
  version: string
  auth: AuthPort
  policy: PolicyPort
  log: LogPort
  events: EventPort
  mNet: MNetPort
  storage: CoreStorage
}
