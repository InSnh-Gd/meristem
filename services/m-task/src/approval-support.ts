import type {
  MTask,
  TaskSuspendedOperation,
  TaskRiskSummary
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import type { MTaskDeps } from './deps.ts'
import { correlationIdFromHeaders } from './task-route-helpers.ts'

type ErrorBody = { error: { code: string; message: string; correlationId?: string } }

export type ApprovalRouteFailure = {
  kind: 'failure'
  status: 401 | 404 | 409 | 500 | 501
  body: ErrorBody
}

type ApprovalRouteContext = {
  correlationId: string
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>
}

export function isApprovalRouteFailure(value: unknown): value is ApprovalRouteFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: string }).kind === 'failure'
  )
}

function routeFailure(
  status: ApprovalRouteFailure['status'],
  body: ErrorBody
): ApprovalRouteFailure {
  return { kind: 'failure', status, body }
}

function taskResourceId(resource: string) {
  return resource.split(':')[1] ?? ''
}

function taskSubmitRisk(value: unknown): TaskRiskSummary {
  return (value as { risk: TaskRiskSummary }).risk
}

/**
 * 审批内部路由统一校验 internal token，并确认 suspended ops 能力已接线。
 */
export function requireApprovalRouteContext(
  deps: MTaskDeps,
  headers: Record<string, string | undefined>
): ApprovalRouteContext | ApprovalRouteFailure {
  const internalAuth = validateInternalRequest(headers)
  if (!internalAuth.ok) return routeFailure(401, { error: internalAuth.error })

  if (!deps.suspendedOps) {
    return routeFailure(501, {
      error: { code: 'not_implemented_yet', message: 'suspended operations not supported' }
    })
  }

  return {
    correlationId: correlationIdFromHeaders(headers),
    suspendedOps: deps.suspendedOps
  }
}

/**
 * 挂起操作的 404 统一在 support 层收口，保持 correlationId 语义稳定。
 */
export async function loadSuspendedOperation(
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  id: string,
  correlationId: string
): Promise<TaskSuspendedOperation | ApprovalRouteFailure> {
  const suspendedOp = await suspendedOps.get(id)
  if (!suspendedOp) {
    return routeFailure(404, {
      error: {
        code: 'task.suspended_op_not_found',
        message: 'suspended operation not found',
        correlationId
      }
    })
  }
  return suspendedOp
}

/**
 * resume/reject 的状态冲突都保持原状态码和错误码，只把重复守卫抽走。
 */
export async function ensureSuspendedForAction(
  deps: MTaskDeps,
  input: {
    suspendedOp: TaskSuspendedOperation
    action: 'resume' | 'reject'
  }
): Promise<true | ApprovalRouteFailure> {
  if (input.suspendedOp.status === 'suspended') return true

  if (input.action === 'resume') {
    await deps.log.writeFull({
      level: 'warn',
      source: 'm-task',
      message: 'resume attempted on non-suspended operation',
      correlationId: input.suspendedOp.correlationId,
      payload: { opId: input.suspendedOp.id, status: input.suspendedOp.status }
    })
  }

  return routeFailure(409, {
    error: {
      code: input.action === 'resume' ? 'task.resume_conflict' : 'task.reject_conflict',
      message: `operation is ${input.suspendedOp.status}`,
      correlationId: input.suspendedOp.correlationId
    }
  })
}

/**
 * 过期审批恢复必须先标记 expired，再返回冲突，确保状态机与旧实现一致。
 */
export async function ensureOperationNotExpired(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation
): Promise<true | ApprovalRouteFailure> {
  if (new Date(suspendedOp.expiresAt) >= new Date()) return true

  await suspendedOps.transition(suspendedOp.id, 'expired', 'approval_expired')
  await deps.log.writeFull({
    level: 'warn',
    source: 'm-task',
    message: 'resume attempted on expired operation',
    correlationId: suspendedOp.correlationId,
    payload: { opId: suspendedOp.id }
  })
  return routeFailure(409, {
    error: {
      code: 'task.resume_expired',
      message: 'suspended operation has expired',
      correlationId: suspendedOp.correlationId
    }
  })
}

async function publishResumeFailure(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation,
  input: {
    terminalReason: string
    failureReason: string
    payload?: Record<string, unknown>
    error: { code: string; message: string }
  }
) {
  await suspendedOps.transition(suspendedOp.id, 'resume_failed', input.terminalReason)
  await deps.events.publish(
    'task.operation.resume.failure.v0',
    createEventEnvelope({
      type: 'task.operation.resume.failure',
      source: 'm-task',
      correlationId: suspendedOp.correlationId,
      payload: {
        opId: suspendedOp.id,
        reason: input.failureReason,
        ...(input.payload ?? {})
      }
    })
  )
  return routeFailure(409, {
    error: {
      code: input.error.code,
      message: input.error.message,
      correlationId: suspendedOp.correlationId
    }
  })
}

async function createTaskFromSuspendedSubmit(
  deps: MTaskDeps,
  suspendedOp: TaskSuspendedOperation,
  resourceId: string
): Promise<MTask> {
  return deps.storage.create({
    nodeId: resourceId,
    type: 'noop',
    actor: suspendedOp.requestedBy,
    correlationId: suspendedOp.correlationId,
    policyDecisionId: suspendedOp.policyDecisionId,
    risk: taskSubmitRisk(suspendedOp.sanitizedPayload)
  })
}

async function resumeTaskCancel(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation
): Promise<MTask | ApprovalRouteFailure> {
  const resourceId = taskResourceId(suspendedOp.resource)
  const task = await deps.storage.get(resourceId)
  if (!task) {
    return publishResumeFailure(deps, suspendedOps, suspendedOp, {
      terminalReason: 'target_task_not_found',
      failureReason: 'target_task_not_found',
      error: { code: 'task.resume_stale', message: 'target task not found' }
    })
  }

  const terminalStatuses: MTask['status'][] = ['completed', 'failed', 'canceled', 'timed_out']
  if (terminalStatuses.includes(task.status)) {
    return publishResumeFailure(deps, suspendedOps, suspendedOp, {
      terminalReason: 'task_in_terminal_state',
      failureReason: 'task_in_terminal_state',
      payload: { taskStatus: task.status },
      error: {
        code: 'task.resume_stale',
        message: `task is in terminal state: ${task.status}`
      }
    })
  }

  const canceledTask = await deps.storage.transition(resourceId, 'canceled', {
    canceledAt: new Date().toISOString()
  })
  if (!canceledTask) {
    return publishResumeFailure(deps, suspendedOps, suspendedOp, {
      terminalReason: 'target_task_not_found',
      failureReason: 'target_task_not_found',
      error: { code: 'task.resume_stale', message: 'target task not found' }
    })
  }
  return canceledTask
}

async function resumeTaskRetry(deps: MTaskDeps, suspendedOp: TaskSuspendedOperation, task: MTask) {
  await deps.log.writeFull({
    level: 'warn',
    source: 'm-task',
    message: 'retry resume executed but retry is not implemented',
    correlationId: suspendedOp.correlationId,
    payload: { opId: suspendedOp.id }
  })
  return task
}

/**
 * 恢复成功路径统一收口 transition/audit/timeline/event 顺序，避免路由层重复四段副作用。
 */
export async function finalizeResumedOperation(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation,
  task: MTask | null
) {
  await suspendedOps.transition(suspendedOp.id, 'resumed')
  await deps.log.writeAudit({
    actor: 'system',
    action: 'task.operation.resume',
    resource: suspendedOp.resource,
    decisionId: suspendedOp.policyDecisionId,
    result: 'resumed',
    correlationId: suspendedOp.correlationId
  })
  await deps.log.writeTimeline({
    summary: `operation resumed: ${suspendedOp.action} on ${suspendedOp.resource}`,
    subject: 'task.operation.resumed',
    correlationId: suspendedOp.correlationId
  })
  await deps.events.publish(
    'task.operation.resumed.v0',
    createEventEnvelope({
      type: 'task.operation.resumed',
      source: 'm-task',
      correlationId: suspendedOp.correlationId,
      payload: {
        opId: suspendedOp.id,
        action: suspendedOp.action,
        resource: suspendedOp.resource,
        taskId: task?.id
      }
    })
  )
}

/**
 * resume 的真实业务分支在 support 层执行，路由只保留入口与响应契约。
 */
export async function resumeSuspendedOperation(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation
): Promise<{ resumed: true; suspendedOpId: string; task: MTask | null } | ApprovalRouteFailure> {
  const resourceId = taskResourceId(suspendedOp.resource)
  let task: MTask | null = null

  try {
    if (suspendedOp.action === 'task.submit') {
      task = await createTaskFromSuspendedSubmit(deps, suspendedOp, resourceId)
    } else if (suspendedOp.action === 'task.cancel') {
      const resumed = await resumeTaskCancel(deps, suspendedOps, suspendedOp)
      if (isApprovalRouteFailure(resumed)) return resumed
      task = resumed
    } else if (suspendedOp.action === 'task.retry') {
      const existing = await deps.storage.get(resourceId)
      if (!existing) {
        return publishResumeFailure(deps, suspendedOps, suspendedOp, {
          terminalReason: 'target_task_not_found',
          failureReason: 'target_task_not_found',
          error: { code: 'task.resume_stale', message: 'target task not found' }
        })
      }
      task = await resumeTaskRetry(deps, suspendedOp, existing)
    }

    await finalizeResumedOperation(deps, suspendedOps, suspendedOp, task)
    return { resumed: true, suspendedOpId: suspendedOp.id, task }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'resume failed'
    await suspendedOps.transition(suspendedOp.id, 'resume_failed', `resume_error: ${message}`)
    await deps.log.writeFull({
      level: 'error',
      source: 'm-task',
      message: `resume failed: ${message}`,
      correlationId: suspendedOp.correlationId,
      payload: { opId: suspendedOp.id, error: message }
    })
    await deps.events.publish(
      'task.operation.resume.failure.v0',
      createEventEnvelope({
        type: 'task.operation.resume.failure',
        source: 'm-task',
        correlationId: suspendedOp.correlationId,
        payload: { opId: suspendedOp.id, reason: message }
      })
    )
    return routeFailure(500, {
      error: {
        code: 'task.resume_failed',
        message,
        correlationId: suspendedOp.correlationId
      }
    })
  }
}

/**
 * reject 成功路径也收口到 support，保持 audit/timeline/event 顺序稳定。
 */
export async function rejectSuspendedOperation(
  deps: MTaskDeps,
  suspendedOps: NonNullable<MTaskDeps['suspendedOps']>,
  suspendedOp: TaskSuspendedOperation
) {
  await suspendedOps.transition(suspendedOp.id, 'rejected', 'approval_rejected')
  await deps.log.writeAudit({
    actor: 'system',
    action: 'task.operation.reject',
    resource: suspendedOp.resource,
    decisionId: suspendedOp.policyDecisionId,
    result: 'rejected',
    correlationId: suspendedOp.correlationId
  })
  await deps.log.writeTimeline({
    summary: `operation rejected: ${suspendedOp.action} on ${suspendedOp.resource}`,
    subject: 'task.operation.rejected',
    correlationId: suspendedOp.correlationId
  })
  await deps.events.publish(
    'task.operation.rejected.v0',
    createEventEnvelope({
      type: 'task.operation.rejected',
      source: 'm-task',
      correlationId: suspendedOp.correlationId,
      payload: {
        opId: suspendedOp.id,
        action: suspendedOp.action,
        resource: suspendedOp.resource
      }
    })
  )
  return { rejected: true, suspendedOpId: suspendedOp.id }
}
