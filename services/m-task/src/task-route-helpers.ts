import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  ApprovalOriginAction,
  MTask,
  MTaskPolicyDecision,
  OperationDangerLevel,
  Permission,
  RiskFactor,
  TaskPolicyResult,
  TaskRiskSummary
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import type { MTaskDeps } from './deps.ts'

type AuthContext = { actor: ActorId; correlationId: string }

type BlockingTaskPolicyDecision = MTaskPolicyDecision & {
  result: Exclude<TaskPolicyResult, 'allow'>
}

export function correlationIdFromHeaders(headers: Record<string, string | undefined>): string {
  const value = headers['x-correlation-id']
  return value && value.trim().length > 0 ? value : crypto.randomUUID()
}

/**
 * 统一 Bearer token 校验与关联 ID 提取，确保所有公开路由共享一致的鉴权失败语义。
 */
export async function requireActor(
  deps: MTaskDeps,
  headers: Record<string, string | undefined>
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeaders(headers)
  const token = extractBearerToken(headers.authorization)
  if (!token)
    throw Object.assign(new Error('Bearer token is required'), {
      status: 401,
      code: 'auth.missing_token',
      correlationId
    })

  const verified = await deps.auth.verify(token)
  if (!verified.ok)
    throw Object.assign(new Error(verified.error.message), {
      status: 401,
      code: verified.error.code,
      correlationId
    })

  return { actor: verified.value.actor, correlationId }
}

function dangerForAction(action: Permission, type: 'noop'): OperationDangerLevel {
  if (action === 'task:submit' && type === 'noop') return 'medium'
  if (action === 'task:cancel' || action === 'task:retry') return 'high'
  if (action === 'task:manage') return 'critical'
  return 'low'
}

/**
 * 任务风险画像必须保持纯函数，避免路由拆分后引入隐藏副作用或顺序漂移。
 */
export function riskFor(input: { action: Permission; type: 'noop' }): TaskRiskSummary {
  const operationDangerLevel = dangerForAction(input.action, input.type)
  const baseScore: Record<OperationDangerLevel, number> = {
    low: 10,
    medium: 35,
    high: 70,
    critical: 90
  }
  const riskFactors: RiskFactor[] = [
    'actor_permission_level',
    'operation_danger_level',
    'task_type_risk',
    'audit_visibility'
  ]
  return { operationDangerLevel, suspicionScore: baseScore[operationDangerLevel], riskFactors }
}

/**
 * 所有策略决策错误统一映射为 503，保持服务边界上的 fail-closed 行为不变。
 */
export async function decideOrThrow(
  deps: MTaskDeps,
  input: {
    actor: ActorId
    action: Permission
    resource: string
    risk: TaskRiskSummary
    correlationId: string
  }
): Promise<MTaskPolicyDecision> {
  const decision = await deps.policy.decide(input)
  if (!decision.ok)
    throw Object.assign(new Error(decision.error.message), {
      status: 503,
      code: decision.error.code,
      correlationId: input.correlationId
    })
  return decision.value
}

/**
 * 策略阻断必须先写 Full/Audit，再创建挂起操作和审批记录，确保审计顺序稳定。
 */
export async function blockIfNeeded(
  deps: MTaskDeps,
  input: {
    actor: ActorId
    action: Permission
    resource: string
    decision: MTaskPolicyDecision
    risk: TaskRiskSummary
    correlationId: string
  }
): Promise<{
  status: 403 | 409
  body: { policyDecision: BlockingTaskPolicyDecision; risk: TaskRiskSummary }
} | null> {
  if (input.decision.result === 'allow') return null
  const blockingDecision = input.decision as BlockingTaskPolicyDecision

  await deps.log.writeFull({
    level: 'warn',
    source: 'm-task',
    message: `policy blocked ${input.action}`,
    correlationId: input.correlationId,
    payload: {
      decisionId: blockingDecision.decisionId,
      result: blockingDecision.result,
      risk: input.risk
    }
  })
  await deps.log.writeAudit({
    actor: input.actor,
    action: input.action.replace(':', '.'),
    resource: input.resource,
    decisionId: blockingDecision.decisionId,
    result: blockingDecision.result,
    correlationId: input.correlationId,
    payload: { risk: input.risk }
  })

  if (blockingDecision.result !== 'deny' && deps.suspendedOps) {
    const idempotencyKey = crypto.randomUUID()
    const suspendedOp = await deps.suspendedOps.create({
      policyDecisionId: blockingDecision.decisionId,
      action: input.action.replace(':', '.') as ApprovalOriginAction,
      requestedBy: input.actor,
      resource: input.resource,
      sanitizedPayload: { action: input.action, resource: input.resource, risk: input.risk },
      correlationId: input.correlationId,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    })
    if (deps.approvals && blockingDecision.requiredAction) {
      const approval = await deps.approvals.create({
        policyDecisionId: blockingDecision.decisionId,
        originService: 'm-task',
        operationId: suspendedOp.id,
        requestedBy: input.actor,
        requiredAction: blockingDecision.requiredAction,
        quorumRequired: blockingDecision.requiredAction === 'multi_approval' ? 2 : 1,
        expiresAt: suspendedOp.expiresAt
      })
      if (!approval.ok)
        throw Object.assign(new Error(approval.error.message), {
          status: 503,
          code: approval.error.code,
          correlationId: input.correlationId
        })
    }
    await deps.events.publish(
      'task.operation.suspended.v0',
      createEventEnvelope({
        type: 'task.operation.suspended',
        source: 'm-task',
        correlationId: input.correlationId,
        payload: {
          decisionId: blockingDecision.decisionId,
          action: input.action,
          resource: input.resource,
          actor: input.actor
        }
      })
    )
  }

  return {
    status: blockingDecision.result === 'deny' ? 403 : 409,
    body: { policyDecision: blockingDecision, risk: input.risk }
  }
}

/**
 * 任务事件必须继续使用原 subject/type/payload 组合，避免下游契约漂移。
 */
export async function publishTaskEvent(
  deps: MTaskDeps,
  subject: string,
  type: string,
  task: MTask,
  correlationId: string
): Promise<void> {
  await deps.events.publish(
    subject,
    createEventEnvelope({
      type,
      source: 'm-task',
      subject: task.id,
      correlationId,
      payload: { taskId: task.id, nodeId: task.nodeId, type: task.type, status: task.status }
    })
  )
}

/**
 * 生命周期迁移与 Timeline 写入绑定，确保状态事实与用户可见时间线保持同序。
 */
export async function transitionWithTimeline(
  deps: MTaskDeps,
  taskId: string,
  status: MTask['status'],
  correlationId: string,
  patch?: Partial<Pick<MTask, 'completedAt' | 'canceledAt'>>
): Promise<MTask> {
  const task = await deps.storage.transition(taskId, status, patch)
  if (!task)
    throw Object.assign(new Error('task not found'), {
      status: 404,
      code: 'task.not_found',
      correlationId
    })

  await deps.log.writeTimeline({
    summary: `${status} noop task ${task.id}`,
    subject: task.id,
    correlationId
  })
  return task
}
