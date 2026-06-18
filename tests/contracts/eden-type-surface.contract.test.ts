import { describe, expect, it } from 'bun:test'
import type { Result } from '../../packages/common/src/result.ts'
import type {
  ActorId,
  ApprovalOriginAction,
  AuditLog,
  AuditSearchQuery,
  BackfillParams,
  BackfillResult,
  CreateNetworkRequest,
  DLQRecord,
  EventBusPublishMetricsSummaryFromSchema,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  MNetwork,
  MNetworkMember,
  MTask,
  MTaskPolicyDecision,
  NetworkSummary,
  NodeAgentTaskExecuteResponse,
  Permission,
  ProjectionHealth,
  SubmitTaskRequest,
  TaskRiskSummary,
  TaskSuspendedOperation,
  TimelineLog,
  TimelineSearchQuery
} from '../../packages/contracts/src/index.ts'
import type {
  MNetRegionalProfile,
  NetworkSuspendedOperation
} from '../../packages/contracts/src/types/mnet-profile.ts'
import type { MEventEnvelope } from '../../packages/events/src/index.ts'
import type { createEventBusApp, EventBusAppDeps } from '../../services/m-eventbus/src/app.ts'
import type { EventBusApp as PublicEventBusApp } from '../../services/m-eventbus/src/public-types.ts'
import type {
  createLogApp,
  LogAppDeps,
  ProjectionDeps,
  SearchDeps
} from '../../services/m-log/src/app.ts'
import type { LogApp as PublicLogApp } from '../../services/m-log/src/public-types.ts'
import type {
  createMNetApp,
  MNetAppDeps,
  MNetServiceError,
  MNetServiceResult
} from '../../services/m-net/src/app.ts'
import type { DataPlaneStores } from '../../services/m-net/src/data-plane-store-types.ts'
import type { GlobalDefaultsStore } from '../../services/m-net/src/global-defaults-store.ts'
import type { MigrationEngine } from '../../services/m-net/src/migration-engine.ts'
import type { ProfileDisablePolicyStore } from '../../services/m-net/src/profile-disable-policy.ts'
import type { MNetApp as PublicMNetApp } from '../../services/m-net/src/public-types.ts'
import type {
  createMTaskApp,
  MTaskCreateInput,
  MTaskDeliveryPort,
  MTaskDeps
} from '../../services/m-task/src/app.ts'
import type { MTaskApp as PublicMTaskApp } from '../../services/m-task/src/public-types.ts'

type Expect<T extends true> = T
type Same<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2
    ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
      ? true
      : false
    : false

type ExpectedServiceError = { code: string; message: string }

type ExpectedMTaskCreateInput = SubmitTaskRequest & {
  actor: ActorId
  correlationId: string
  policyDecisionId: string
  risk: TaskRiskSummary
}

type ExpectedMTaskDeliveryPort = {
  submitDelivery(input: {
    nodeId: string
    taskId: string
    correlationId: string
  }): Promise<Result<{ completedAt: string } | { queued: true }, ExpectedServiceError>>
  cancelDelivery(input: {
    taskId: string
    correlationId: string
  }): Promise<Result<'cancelAccepted' | 'cancelRejected' | 'notDeliverable', ExpectedServiceError>>
}

type ExpectedMTaskDeps = {
  auth: {
    verify(token: string): Promise<Result<{ actor: ActorId }, ExpectedServiceError>>
  }
  policy: {
    decide(input: {
      actor: ActorId
      action: Permission
      resource: string
      risk: TaskRiskSummary
      correlationId: string
    }): Promise<Result<MTaskPolicyDecision, ExpectedServiceError>>
  }
  log: {
    writeTimeline(
      input: Omit<TimelineLog, 'id' | 'timestamp'>
    ): Promise<Result<TimelineLog, ExpectedServiceError>>
    writeFull(
      input: Omit<FullLog, 'id' | 'timestamp'>
    ): Promise<Result<FullLog, ExpectedServiceError>>
    writeAudit(
      input: Omit<AuditLog, 'id' | 'timestamp'>
    ): Promise<Result<AuditLog, ExpectedServiceError>>
  }
  events: {
    publish(
      subject: string,
      event: MEventEnvelope
    ): Promise<Result<{ eventId: string }, ExpectedServiceError>>
  }
  approvals?: {
    create(input: {
      policyDecisionId: string
      originService: 'm-task'
      operationId: string
      requestedBy: ActorId
      requiredAction: 'manual_review' | 'multi_approval'
      quorumRequired: number
      expiresAt: string
    }): Promise<Result<{ approvalId: string }, ExpectedServiceError>>
  }
  delivery: ExpectedMTaskDeliveryPort
  storage: {
    create(input: ExpectedMTaskCreateInput): Promise<MTask>
    list(): Promise<MTask[]>
    get(id: string): Promise<MTask | null>
    transition(
      id: string,
      status: MTask['status'],
      patch?: Partial<Pick<MTask, 'completedAt' | 'canceledAt'>>
    ): Promise<MTask | null>
  }
  suspendedOps?: {
    create(input: {
      policyDecisionId: string
      action: ApprovalOriginAction
      requestedBy: ActorId
      resource: string
      sanitizedPayload: unknown
      correlationId: string
      idempotencyKey: string
      expiresAt: string
    }): Promise<TaskSuspendedOperation>
    get(id: string): Promise<TaskSuspendedOperation | null>
    getByPolicyDecisionId(policyDecisionId: string): Promise<TaskSuspendedOperation | null>
    transition(
      id: string,
      status: TaskSuspendedOperation['status'],
      terminalReason?: string
    ): Promise<TaskSuspendedOperation | null>
  }
}

type ExpectedMNetServiceError = {
  code: string
  message: string
}

type ExpectedMNetServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExpectedMNetServiceError }

type ExpectedMNetAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  createNetwork(input: CreateNetworkRequest): Promise<ExpectedMNetServiceResult<MNetwork>>
  listNetworks(): Promise<ExpectedMNetServiceResult<NetworkSummary[]>>
  joinNetwork(input: {
    networkId: string
    nodeId: string
  }): Promise<ExpectedMNetServiceResult<MNetworkMember>>
  listMembers(input: { networkId: string }): Promise<ExpectedMNetServiceResult<MNetworkMember[]>>
  executeNoop(input: {
    nodeId: string
    taskId: string
    correlationId: string
  }): Promise<ExpectedMNetServiceResult<NodeAgentTaskExecuteResponse>>
  profileStore?: {
    getDefinitions(): Promise<MNetRegionalProfile[]>
    getDefinition(profileVersion: string): Promise<MNetRegionalProfile | null>
    getNetworkState(networkId: string): Promise<{
      networkId: string
      profileVersion: string
      status: string
      updatedAt: string
    } | null>
    setNetworkState(
      networkId: string,
      state: { profileVersion: string; status: string }
    ): Promise<void>
    recordTransition(record: {
      networkId: string
      fromVersion: string
      toVersion: string
      fromStatus: string
      toStatus: string
      actor: string
      reason?: string
      policyDecisionId?: string
      correlationId?: string
    }): Promise<void>
    listNetworkStates(): Promise<
      Array<{ networkId: string; profileVersion: string; status: string; updatedAt: string }>
    >
  }
  networkUpdater?: {
    setProfileVersion(networkId: string, profileVersion: string): Promise<void>
  }
  policyAuthorize?: {
    authorize(
      actor: string,
      action: string,
      resource: string
    ): Promise<{
      result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
      id: string
      reasons: string[]
    }>
  }
  suspendedOps?: {
    create(input: {
      policyDecisionId: string
      action: string
      networkId: string
      fromProfileVersion: string
      toProfileVersion: string
      requestedBy: string
      reason?: string
      correlationId: string
      idempotencyKey: string
      expiresAt: string
    }): Promise<NetworkSuspendedOperation>
    get(id: string): Promise<NetworkSuspendedOperation | null>
    transition(
      id: string,
      status: string,
      terminalReason?: string
    ): Promise<NetworkSuspendedOperation | null>
  }
  approvals?: {
    create(input: {
      policyDecisionId: string
      originService: string
      operationId: string
      requestedBy: string
      requiredAction: string
      quorumRequired: number
      expiresAt: string
    }): Promise<
      | { ok: true; value: { approvalId: string } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
  events?: {
    publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
  }
  log?: {
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(
      level: string,
      message: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
    writeAudit(
      actor: string,
      action: string,
      resource: string,
      result: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
  }
  profileDisablePolicy?: ProfileDisablePolicyStore
  policyHealthCheck?: {
    checkHealth(): Promise<{ healthy: boolean }>
  }
  /** 数据面存储（NATS KV/PostgreSQL 分区状态、操作锁、迁移记录） */
  dataPlane?: DataPlaneStores
  globalDefaultsStore?: GlobalDefaultsStore
  migrationEngine?: MigrationEngine
}

type ExpectedEventBusAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  publishMetricsSummary(): EventBusPublishMetricsSummaryFromSchema
  publish(subject: string, event: MEventEnvelope): Promise<{ eventId: string }>
  reportRejected(input: {
    subject: string
    event: unknown
    reason: 'invalid_envelope' | 'subject_not_allowed' | 'subject_mismatch'
    errors: string[]
  }): Promise<void>
}

type TimelineWriteInput = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteInput = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteInput = Omit<AuditLog, 'id' | 'timestamp'>

type ExpectedSearchDeps = {
  full(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null>
  timeline(query: TimelineSearchQuery): Promise<LogSearchResult<TimelineLog> | null>
  audit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null>
  isAvailable(): boolean
}

type ExpectedProjectionDeps = {
  getProjectionHealth(): Promise<ProjectionHealth[]>
  executeBackfill(params: BackfillParams): Promise<BackfillResult>
  listDLQ(index?: string): Promise<DLQRecord[]>
  replayDLQ(dlqId: string): Promise<boolean>
  skipDLQ(dlqId: string): Promise<void>
  isAvailable(): boolean
}

type ExpectedLogAppDeps = {
  readiness(): Promise<{ ready: boolean; opensearch: 'ready' | 'unavailable' }>
  writeTimeline(input: TimelineWriteInput): Promise<TimelineLog>
  writeFull(input: FullWriteInput): Promise<FullLog>
  writeAudit(input: AuditWriteInput): Promise<AuditLog>
  listTimeline(limit?: number): Promise<TimelineLog[]>
  listFull(limit?: number): Promise<FullLog[]>
  listAudit(limit?: number): Promise<AuditLog[]>
  reload(input: { correlationId?: string; reason?: string }): Promise<{
    serviceId: string
    reloadedAt: string
  }>
  search: ExpectedSearchDeps
  projection: ExpectedProjectionDeps
}

type SurfaceChecks = [
  Expect<Same<PublicMTaskApp, ReturnType<typeof createMTaskApp>>>,
  Expect<Same<Parameters<typeof createMTaskApp>, [deps: MTaskDeps]>>,
  Expect<Same<MTaskCreateInput, ExpectedMTaskCreateInput>>,
  Expect<Same<MTaskDeliveryPort, ExpectedMTaskDeliveryPort>>,
  Expect<Same<MTaskDeps, ExpectedMTaskDeps>>,
  Expect<Same<PublicMNetApp, ReturnType<typeof createMNetApp>>>,
  Expect<Same<Parameters<typeof createMNetApp>, [deps: MNetAppDeps]>>,
  Expect<Same<MNetServiceError, ExpectedMNetServiceError>>,
  Expect<Same<MNetServiceResult<string>, ExpectedMNetServiceResult<string>>>,
  Expect<Same<MNetAppDeps, ExpectedMNetAppDeps>>,
  Expect<Same<PublicEventBusApp, ReturnType<typeof createEventBusApp>>>,
  Expect<Same<Parameters<typeof createEventBusApp>, [deps: EventBusAppDeps]>>,
  Expect<Same<EventBusAppDeps, ExpectedEventBusAppDeps>>,
  Expect<Same<PublicLogApp, ReturnType<typeof createLogApp>>>,
  Expect<Same<Parameters<typeof createLogApp>, [deps: LogAppDeps]>>,
  Expect<Same<SearchDeps, ExpectedSearchDeps>>,
  Expect<Same<ProjectionDeps, ExpectedProjectionDeps>>,
  Expect<Same<LogAppDeps, ExpectedLogAppDeps>>
]

const compileTimeSurfaceChecks: SurfaceChecks = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true
]

describe('Eden public type surface', () => {
  it('keeps app type names and factory signatures compile-stable', () => {
    expect(compileTimeSurfaceChecks.every(Boolean)).toBe(true)
  })
})
