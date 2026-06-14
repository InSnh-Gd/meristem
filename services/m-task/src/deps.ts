import type { Result } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  ApprovalOriginAction,
  AuditLog,
  FullLog,
  MTask,
  MTaskPolicyDecision,
  Permission,
  SubmitTaskRequest,
  TaskRiskSummary,
  TaskSuspendedOperation,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import type { MEventEnvelope } from '../../../packages/events/src/index.ts'

export type ServiceError = { code: string; message: string }

export type MTaskCreateInput = SubmitTaskRequest & {
  actor: ActorId
  correlationId: string
  policyDecisionId: string
  risk: TaskRiskSummary
}

export type MTaskDeliveryPort = {
  submitDelivery(input: {
    nodeId: string
    taskId: string
    correlationId: string
  }): Promise<Result<{ completedAt: string } | { queued: true }, ServiceError>>
  cancelDelivery(input: {
    taskId: string
    correlationId: string
  }): Promise<Result<'cancelAccepted' | 'cancelRejected' | 'notDeliverable', ServiceError>>
}

export type MTaskDeps = {
  auth: {
    verify(token: string): Promise<Result<{ actor: ActorId }, ServiceError>>
  }
  policy: {
    decide(input: {
      actor: ActorId
      action: Permission
      resource: string
      risk: TaskRiskSummary
      correlationId: string
    }): Promise<Result<MTaskPolicyDecision, ServiceError>>
  }
  log: {
    writeTimeline(
      input: Omit<TimelineLog, 'id' | 'timestamp'>
    ): Promise<Result<TimelineLog, ServiceError>>
    writeFull(input: Omit<FullLog, 'id' | 'timestamp'>): Promise<Result<FullLog, ServiceError>>
    writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>): Promise<Result<AuditLog, ServiceError>>
  }
  events: {
    publish(
      subject: string,
      event: MEventEnvelope
    ): Promise<Result<{ eventId: string }, ServiceError>>
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
    }): Promise<Result<{ approvalId: string }, ServiceError>>
  }
  delivery: MTaskDeliveryPort
  storage: {
    create(input: MTaskCreateInput): Promise<MTask>
    list(): Promise<MTask[]>
    get(id: string): Promise<MTask | null>
    transition(
      id: string,
      status: MTask['status'],
      patch?: Partial<Pick<MTask, 'completedAt' | 'canceledAt'>>
    ): Promise<MTask | null>
  }
  // 挂起操作存储，M-Task 拥有 suspended operation 生命周期。
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
