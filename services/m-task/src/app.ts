import { Elysia, t } from 'elysia'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import { ok, type Result } from '../../../packages/common/src/result.ts'
import type { ActorId, ApprovalOriginAction, AuditLog, FullLog, MTask, MTaskPolicyDecision, OperationDangerLevel, Permission, RiskFactor, SubmitTaskRequest, TaskPolicyResult, TaskRiskSummary, TaskSuspendedOperation, TimelineLog } from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope, type MEventEnvelope } from '../../../packages/events/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'

type ServiceError = { code: string; message: string }
type BlockingTaskPolicyDecision = MTaskPolicyDecision & { result: Exclude<TaskPolicyResult, 'allow'> }
export type MTaskCreateInput = SubmitTaskRequest & {
  actor: ActorId
  correlationId: string
  policyDecisionId: string
  risk: TaskRiskSummary
}

export type MTaskDeliveryPort = {
  submitDelivery(input: { nodeId: string; taskId: string; correlationId: string }): Promise<Result<{ completedAt: string } | { queued: true }, ServiceError>>
  cancelDelivery(input: { taskId: string; correlationId: string }): Promise<Result<'cancelAccepted' | 'cancelRejected' | 'notDeliverable', ServiceError>>
}

export type MTaskDeps = {
  auth: {
    verify(token: string): Promise<Result<{ actor: ActorId }, ServiceError>>
  }
  policy: {
    decide(input: { actor: ActorId; action: Permission; resource: string; risk: TaskRiskSummary; correlationId: string }): Promise<Result<MTaskPolicyDecision, ServiceError>>
  }
  log: {
    writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>): Promise<Result<TimelineLog, ServiceError>>
    writeFull(input: Omit<FullLog, 'id' | 'timestamp'>): Promise<Result<FullLog, ServiceError>>
    writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>): Promise<Result<AuditLog, ServiceError>>
  }
  events: {
    publish(subject: string, event: MEventEnvelope): Promise<Result<{ eventId: string }, ServiceError>>
  }
  approvals?: {
    create(input: { policyDecisionId: string; originService: 'm-task'; operationId: string; requestedBy: ActorId; requiredAction: 'manual_review' | 'multi_approval'; quorumRequired: number; expiresAt: string }): Promise<Result<{ approvalId: string }, ServiceError>>
  }
  delivery: MTaskDeliveryPort
  storage: {
    create(input: MTaskCreateInput): Promise<MTask>
    list(): Promise<MTask[]>
    get(id: string): Promise<MTask | null>
    transition(id: string, status: MTask['status'], patch?: Partial<Pick<MTask, 'completedAt' | 'canceledAt'>>): Promise<MTask | null>
  }
  // 挂起操作存储，M-Task 拥有 suspended operation 生命周期。
  suspendedOps?: {
    create(input: { policyDecisionId: string; action: ApprovalOriginAction; requestedBy: ActorId; resource: string; sanitizedPayload: unknown; correlationId: string; idempotencyKey: string; expiresAt: string }): Promise<TaskSuspendedOperation>
    get(id: string): Promise<TaskSuspendedOperation | null>
    getByPolicyDecisionId(policyDecisionId: string): Promise<TaskSuspendedOperation | null>
    transition(id: string, status: TaskSuspendedOperation['status'], terminalReason?: string): Promise<TaskSuspendedOperation | null>
  }
}

type AuthContext = { actor: ActorId; correlationId: string }

const apiErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

const riskSchema = t.Object({
  operationDangerLevel: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('critical')]),
  suspicionScore: t.Number(),
  riskFactors: t.Array(t.String())
})

const taskSchema = t.Object({
  id: t.String(),
  nodeId: t.String(),
  leafNodeId: t.String(),
  type: t.Literal('noop'),
  status: t.Union([
    t.Literal('accepted'),
    t.Literal('queued'),
    t.Literal('dispatched'),
    t.Literal('running'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('cancel_requested'),
    t.Literal('canceled'),
    t.Literal('timed_out')
  ]),
  createdAt: t.String(),
  updatedAt: t.String(),
  timeoutAt: t.Optional(t.String()),
  completedAt: t.Optional(t.String()),
  canceledAt: t.Optional(t.String())
})

const policyBlockSchema = t.Object({
  policyDecision: t.Object({
    decisionId: t.String(),
    result: t.Union([t.Literal('require_manual_review'), t.Literal('require_multi_approval'), t.Literal('deny')]),
    requiredAction: t.Optional(t.Union([t.Literal('manual_review'), t.Literal('multi_approval'), t.Undefined()])),
    reasons: t.Array(t.String())
  }),
  risk: riskSchema
})

const retryNotImplementedSchema = t.Object({
  error: t.Object({
    code: t.Literal('not_implemented_yet'),
    message: t.String()
  }),
  decisionId: t.String(),
  risk: riskSchema
})

function correlationIdFromHeaders(headers: Record<string, string | undefined>): string {
  const value = headers['x-correlation-id']
  return value && value.trim().length > 0 ? value : crypto.randomUUID()
}

async function requireActor(deps: MTaskDeps, headers: Record<string, string | undefined>): Promise<AuthContext> {
  const correlationId = correlationIdFromHeaders(headers)
  const token = extractBearerToken(headers.authorization)
  if (!token) throw Object.assign(new Error('Bearer token is required'), { status: 401, code: 'auth.missing_token', correlationId })
  const verified = await deps.auth.verify(token)
  if (!verified.ok) throw Object.assign(new Error(verified.error.message), { status: 401, code: verified.error.code, correlationId })
  return { actor: verified.value.actor, correlationId }
}

function dangerForAction(action: Permission, type: 'noop'): OperationDangerLevel {
  if (action === 'task:submit' && type === 'noop') return 'medium'
  if (action === 'task:cancel' || action === 'task:retry') return 'high'
  if (action === 'task:manage') return 'critical'
  return 'low'
}

function riskFor(input: { action: Permission; type: 'noop' }): TaskRiskSummary {
  const operationDangerLevel = dangerForAction(input.action, input.type)
  const baseScore: Record<OperationDangerLevel, number> = { low: 10, medium: 35, high: 70, critical: 90 }
  const riskFactors: RiskFactor[] = ['actor_permission_level', 'operation_danger_level', 'task_type_risk', 'audit_visibility']
  return { operationDangerLevel, suspicionScore: baseScore[operationDangerLevel], riskFactors }
}

async function decideOrThrow(deps: MTaskDeps, input: { actor: ActorId; action: Permission; resource: string; risk: TaskRiskSummary; correlationId: string }): Promise<MTaskPolicyDecision> {
  const decision = await deps.policy.decide(input)
  if (!decision.ok) throw Object.assign(new Error(decision.error.message), { status: 503, code: decision.error.code, correlationId: input.correlationId })
  return decision.value
}

async function blockIfNeeded(deps: MTaskDeps, input: { actor: ActorId; action: Permission; resource: string; decision: MTaskPolicyDecision; risk: TaskRiskSummary; correlationId: string }): Promise<{ status: 403 | 409; body: { policyDecision: BlockingTaskPolicyDecision; risk: TaskRiskSummary } } | null> {
  if (input.decision.result === 'allow') return null
  const blockingDecision = input.decision as BlockingTaskPolicyDecision

  await deps.log.writeFull({
    level: 'warn',
    source: 'm-task',
    message: `policy blocked ${input.action}`,
    correlationId: input.correlationId,
    payload: { decisionId: blockingDecision.decisionId, result: blockingDecision.result, risk: input.risk }
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

  // 当 M-Policy 返回 require_manual_review 或 require_multi_approval 时，
  // M-Task 创建挂起操作记录，等待审批通过后 resume。
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
      if (!approval.ok) throw Object.assign(new Error(approval.error.message), { status: 503, code: approval.error.code, correlationId: input.correlationId })
    }
    await deps.events.publish('task.operation.suspended.v0', createEventEnvelope({
      type: 'task.operation.suspended',
      source: 'm-task',
      correlationId: input.correlationId,
      payload: { decisionId: blockingDecision.decisionId, action: input.action, resource: input.resource, actor: input.actor }
    }))
  }

  return {
    status: blockingDecision.result === 'deny' ? 403 : 409,
    body: { policyDecision: blockingDecision, risk: input.risk }
  }
}

async function publishTaskEvent(deps: MTaskDeps, subject: string, type: string, task: MTask, correlationId: string): Promise<void> {
  await deps.events.publish(subject, createEventEnvelope({
    type,
    source: 'm-task',
    subject: task.id,
    correlationId,
    payload: { taskId: task.id, nodeId: task.nodeId, type: task.type, status: task.status }
  }))
}

async function transitionWithTimeline(deps: MTaskDeps, taskId: string, status: MTask['status'], correlationId: string, patch?: Partial<Pick<MTask, 'completedAt' | 'canceledAt'>>): Promise<MTask> {
  const task = await deps.storage.transition(taskId, status, patch)
  if (!task) throw Object.assign(new Error('task not found'), { status: 404, code: 'task.not_found', correlationId })
  await deps.log.writeTimeline({ summary: `${status} noop task ${task.id}`, subject: task.id, correlationId })
  return task
}

/**
 * M-Task owns the canonical task REST surface. Elysia handlers keep
 * auth, policy/risk, lifecycle writes, event publication, and log behavior in one
 * visible boundary so Core cannot silently remain the task orchestrator.
 */
export function createMTaskApp(deps: MTaskDeps) {
  return new Elysia()
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string; correlationId?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return { error: { code: maybe.code, message: maybe.message, correlationId: maybe.correlationId } }
      }
      return undefined
    })
    .get('/health', () => ({ ok: true as const, service: 'm-task' as const }))
    .get('/api/v0/task-definitions', async ({ headers }) => {
      await requireActor(deps, headers)
      return { taskDefinitions: [{ type: 'noop' as const, version: 'v0', timeoutSeconds: 30 }] }
    })
    .get('/api/v0/tasks', async ({ headers }) => {
      await requireActor(deps, headers)
      return { tasks: await deps.storage.list() }
    }, {
      response: { 200: t.Object({ tasks: t.Array(taskSchema) }), 401: apiErrorSchema }
    })
    .post('/api/v0/tasks', async ({ body, headers, status }) => withExtractedSpan('m-task', 'm-task.task.submit', headers, async () => {
      const auth = await requireActor(deps, headers)
      const risk = riskFor({ action: 'task:submit', type: body.type })
      const decision = await decideOrThrow(deps, { actor: auth.actor, action: 'task:submit', resource: `node:${body.nodeId}`, risk, correlationId: auth.correlationId })
      const blocked = await blockIfNeeded(deps, { actor: auth.actor, action: 'task:submit', resource: `node:${body.nodeId}`, decision, risk, correlationId: auth.correlationId })
      if (blocked) return status(blocked.status, blocked.body)

      await deps.log.writeAudit({ actor: auth.actor, action: 'task.submit', resource: `node:${body.nodeId}`, decisionId: decision.decisionId, result: decision.result, correlationId: auth.correlationId, payload: { risk } })
      const accepted = await deps.storage.create({ ...body, actor: auth.actor, correlationId: auth.correlationId, policyDecisionId: decision.decisionId, risk })
      await publishTaskEvent(deps, 'task.requested.v0', 'task.requested', accepted, auth.correlationId)
      const queued = await transitionWithTimeline(deps, accepted.id, 'queued', auth.correlationId)
      await publishTaskEvent(deps, 'task.queued.v0', 'task.queued', queued, auth.correlationId)

      const delivered = await deps.delivery.submitDelivery({ nodeId: queued.nodeId, taskId: queued.id, correlationId: auth.correlationId })
      if (!delivered.ok) {
        const failed = await transitionWithTimeline(deps, queued.id, 'failed', auth.correlationId)
        await deps.log.writeFull({ level: 'warn', source: 'm-task', message: delivered.error.message, correlationId: auth.correlationId, payload: { taskId: failed.id } })
        await publishTaskEvent(deps, 'task.failed.v0', 'task.failed', failed, auth.correlationId)
        return { task: failed, policyDecisionId: decision.decisionId, correlationId: auth.correlationId, risk }
      }
      if ('queued' in delivered.value) {
        return { task: queued, policyDecisionId: decision.decisionId, correlationId: auth.correlationId, risk }
      }

      const dispatched = await transitionWithTimeline(deps, queued.id, 'dispatched', auth.correlationId)
      await publishTaskEvent(deps, 'task.dispatched.v0', 'task.dispatched', dispatched, auth.correlationId)
      const running = await transitionWithTimeline(deps, queued.id, 'running', auth.correlationId)
      await publishTaskEvent(deps, 'task.running.v0', 'task.running', running, auth.correlationId)
      const completed = await transitionWithTimeline(deps, queued.id, 'completed', auth.correlationId, { completedAt: delivered.value.completedAt })
      await publishTaskEvent(deps, 'task.completed.v0', 'task.completed', completed, auth.correlationId)
      return { task: completed, policyDecisionId: decision.decisionId, correlationId: auth.correlationId, risk }
    }), {
      body: t.Object({ nodeId: t.String({ minLength: 1 }), type: t.Literal('noop'), timeoutAt: t.Optional(t.String()) }),
      response: { 200: t.Object({ task: taskSchema, policyDecisionId: t.String(), correlationId: t.String(), risk: riskSchema }), 401: apiErrorSchema, 403: policyBlockSchema, 409: policyBlockSchema }
    })
    .get('/api/v0/tasks/:id', async ({ params, headers }) => {
      await requireActor(deps, headers)
      const task = await deps.storage.get(params.id)
      if (!task) throw Object.assign(new Error('task not found'), { status: 404, code: 'task.not_found', correlationId: correlationIdFromHeaders(headers) })
      return { task }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: { 200: t.Object({ task: taskSchema }), 401: apiErrorSchema, 404: apiErrorSchema }
    })
    .post('/api/v0/tasks/:id/cancel', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers)
      const risk = riskFor({ action: 'task:cancel', type: 'noop' })
      const decision = await decideOrThrow(deps, { actor: auth.actor, action: 'task:cancel', resource: `task:${params.id}`, risk, correlationId: auth.correlationId })
      const blocked = await blockIfNeeded(deps, { actor: auth.actor, action: 'task:cancel', resource: `task:${params.id}`, decision, risk, correlationId: auth.correlationId })
      if (blocked) return status(blocked.status, blocked.body)
      await deps.log.writeAudit({ actor: auth.actor, action: 'task.cancel', resource: `task:${params.id}`, decisionId: decision.decisionId, result: decision.result, correlationId: auth.correlationId, payload: { risk } })
      const existing = await deps.storage.get(params.id)
      if (!existing) throw Object.assign(new Error('task not found'), { status: 404, code: 'task.not_found', correlationId: auth.correlationId })
      if (['completed', 'failed', 'timed_out', 'canceled'].includes(existing.status)) {
        throw Object.assign(new Error('terminal tasks cannot be canceled'), { status: 409, code: 'task.terminal', correlationId: auth.correlationId })
      }
      const delivery = existing.status === 'queued'
        ? ok<'cancelAccepted'>('cancelAccepted')
        : await deps.delivery.cancelDelivery({ taskId: existing.id, correlationId: auth.correlationId })
      if (!delivery.ok || delivery.value === 'cancelRejected') {
        await deps.log.writeFull({ level: 'warn', source: 'm-task', message: 'cancelRejected', correlationId: auth.correlationId, payload: { taskId: existing.id } })
        return { task: existing, policyDecisionId: decision.decisionId, correlationId: auth.correlationId, risk }
      }
      const canceled = await transitionWithTimeline(deps, existing.id, 'canceled', auth.correlationId, { canceledAt: new Date().toISOString() })
      await publishTaskEvent(deps, 'task.canceled.v0', 'task.canceled', canceled, auth.correlationId)
      return { task: canceled, policyDecisionId: decision.decisionId, correlationId: auth.correlationId, risk }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: { 200: t.Object({ task: taskSchema, policyDecisionId: t.String(), correlationId: t.String(), risk: riskSchema }), 401: apiErrorSchema, 403: policyBlockSchema, 404: apiErrorSchema, 409: policyBlockSchema }
    })
    .post('/api/v0/tasks/:id/retry', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers)
      const risk = riskFor({ action: 'task:retry', type: 'noop' })
      const decision = await decideOrThrow(deps, { actor: auth.actor, action: 'task:retry', resource: `task:${params.id}`, risk, correlationId: auth.correlationId })
      const blocked = await blockIfNeeded(deps, { actor: auth.actor, action: 'task:retry', resource: `task:${params.id}`, decision, risk, correlationId: auth.correlationId })
      if (blocked) return status(blocked.status, blocked.body)
      await deps.log.writeFull({ level: 'warn', source: 'm-task', message: 'retry is not implemented', correlationId: auth.correlationId, payload: { taskId: params.id, decisionId: decision.decisionId, risk } })
      return status(501, { error: { code: 'not_implemented_yet', message: 'retry is not implemented' }, decisionId: decision.decisionId, risk })
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: { 401: apiErrorSchema, 403: policyBlockSchema, 409: policyBlockSchema, 501: retryNotImplementedSchema }
    })
    // resume 端点供 M-Policy 审批通过后调用，恢复被挂起的操作。
    // M-Task 执行安全检查、幂等检查和过期检查，不重跑 M-Policy 风险决策。
    .post(
      '/internal/v0/task-operations/:id/resume',
      async ({ params, headers, status }) => {
        const internalAuth = validateInternalRequest(headers)
        if (!internalAuth.ok) return status(401, { error: internalAuth.error })
        const auth = correlationIdFromHeaders(headers)
        if (!deps.suspendedOps) return status(501, { error: { code: 'not_implemented_yet', message: 'suspended operations not supported' } })
        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp) return status(404, { error: { code: 'task.suspended_op_not_found', message: 'suspended operation not found', correlationId: auth } })
        if (suspendedOp.status !== 'suspended') {
          await deps.log.writeFull({ level: 'warn', source: 'm-task', message: 'resume attempted on non-suspended operation', correlationId: suspendedOp.correlationId, payload: { opId: suspendedOp.id, status: suspendedOp.status } })
          return status(409, { error: { code: 'task.resume_conflict', message: `operation is ${suspendedOp.status}`, correlationId: suspendedOp.correlationId } })
        }
        if (new Date(suspendedOp.expiresAt) < new Date()) {
          await deps.suspendedOps.transition(suspendedOp.id, 'expired', 'approval_expired')
          await deps.log.writeFull({ level: 'warn', source: 'm-task', message: 'resume attempted on expired operation', correlationId: suspendedOp.correlationId, payload: { opId: suspendedOp.id } })
          return status(409, { error: { code: 'task.resume_expired', message: 'suspended operation has expired', correlationId: suspendedOp.correlationId } })
        }

        // 恢复操作：根据挂起的原始操作类型执行实际业务逻辑
        const resourceParts = suspendedOp.resource.split(':')
        const resourceId = resourceParts[1] ?? ''
        let resultTask: MTask | null = null

        try {
          if (suspendedOp.action === 'task.submit') {
            // task.submit 被策略阻塞时任务尚未创建，审批通过后在此创建任务
            const payload = suspendedOp.sanitizedPayload as { action: string; resource: string; risk: TaskRiskSummary }
            resultTask = await deps.storage.create({
              nodeId: resourceId,
              type: 'noop',
              actor: suspendedOp.requestedBy,
              correlationId: suspendedOp.correlationId,
              policyDecisionId: suspendedOp.policyDecisionId,
              risk: payload.risk
            })
          } else if (suspendedOp.action === 'task.cancel' || suspendedOp.action === 'task.retry') {
            resultTask = await deps.storage.get(resourceId)
            if (!resultTask) {
              await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', 'target_task_not_found')
              await deps.events.publish('task.operation.resume.failure.v0', createEventEnvelope({
                type: 'task.operation.resume.failure',
                source: 'm-task',
                correlationId: suspendedOp.correlationId,
                payload: { opId: suspendedOp.id, reason: 'target_task_not_found' }
              }))
              return status(409, { error: { code: 'task.resume_stale', message: 'target task not found', correlationId: suspendedOp.correlationId } })
            }
            if (suspendedOp.action === 'task.cancel') {
              const terminalStatuses: MTask['status'][] = ['completed', 'failed', 'canceled', 'timed_out']
              if (terminalStatuses.includes(resultTask.status)) {
                await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', 'task_in_terminal_state')
                await deps.events.publish('task.operation.resume.failure.v0', createEventEnvelope({
                  type: 'task.operation.resume.failure',
                  source: 'm-task',
                  correlationId: suspendedOp.correlationId,
                  payload: { opId: suspendedOp.id, reason: 'task_in_terminal_state', taskStatus: resultTask.status }
                }))
                return status(409, { error: { code: 'task.resume_stale', message: `task is in terminal state: ${resultTask.status}`, correlationId: suspendedOp.correlationId } })
              }
              resultTask = await deps.storage.transition(resourceId, 'canceled', { canceledAt: new Date().toISOString() })
            }
            if (suspendedOp.action === 'task.retry') {
              // 不实现 retry 执行语义，只记录 resume 成功
              await deps.log.writeFull({ level: 'warn', source: 'm-task', message: 'retry resume executed but retry is not implemented', correlationId: suspendedOp.correlationId, payload: { opId: suspendedOp.id } })
            }
          }

          await deps.suspendedOps.transition(suspendedOp.id, 'resumed')
          await deps.log.writeAudit({ actor: 'system', action: 'task.operation.resume', resource: suspendedOp.resource, decisionId: suspendedOp.policyDecisionId, result: 'resumed', correlationId: suspendedOp.correlationId })
          await deps.log.writeTimeline({ summary: `operation resumed: ${suspendedOp.action} on ${suspendedOp.resource}`, subject: 'task.operation.resumed', correlationId: suspendedOp.correlationId })
          await deps.events.publish('task.operation.resumed.v0', createEventEnvelope({
            type: 'task.operation.resumed',
            source: 'm-task',
            correlationId: suspendedOp.correlationId,
            payload: { opId: suspendedOp.id, action: suspendedOp.action, resource: suspendedOp.resource, taskId: resultTask?.id }
          }))

          return { resumed: true, suspendedOpId: suspendedOp.id, task: resultTask }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'resume failed'
          await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', `resume_error: ${message}`)
          await deps.log.writeFull({ level: 'error', source: 'm-task', message: `resume failed: ${message}`, correlationId: suspendedOp.correlationId, payload: { opId: suspendedOp.id, error: message } })
          await deps.events.publish('task.operation.resume.failure.v0', createEventEnvelope({
            type: 'task.operation.resume.failure',
            source: 'm-task',
            correlationId: suspendedOp.correlationId,
            payload: { opId: suspendedOp.id, reason: message }
          }))
          return status(500, { error: { code: 'task.resume_failed', message, correlationId: suspendedOp.correlationId } })
        }
      }, {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({ resumed: t.Boolean(), suspendedOpId: t.String(), task: t.Nullable(taskSchema) }),
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
          501: apiErrorSchema
        }
      })
    .post(
      '/internal/v0/task-operations/:id/reject',
      async ({ params, headers, status }) => {
        const internalAuth = validateInternalRequest(headers)
        if (!internalAuth.ok) return status(401, { error: internalAuth.error })
        const correlationId = correlationIdFromHeaders(headers)
        if (!deps.suspendedOps) return status(501, { error: { code: 'not_implemented_yet', message: 'suspended operations not supported' } })
        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp) return status(404, { error: { code: 'task.suspended_op_not_found', message: 'suspended operation not found', correlationId } })
        if (suspendedOp.status !== 'suspended') return status(409, { error: { code: 'task.reject_conflict', message: `operation is ${suspendedOp.status}`, correlationId: suspendedOp.correlationId } })
        await deps.suspendedOps.transition(suspendedOp.id, 'rejected', 'approval_rejected')
        await deps.log.writeAudit({ actor: 'system', action: 'task.operation.reject', resource: suspendedOp.resource, decisionId: suspendedOp.policyDecisionId, result: 'rejected', correlationId: suspendedOp.correlationId })
        await deps.log.writeTimeline({ summary: `operation rejected: ${suspendedOp.action} on ${suspendedOp.resource}`, subject: 'task.operation.rejected', correlationId: suspendedOp.correlationId })
        await deps.events.publish('task.operation.rejected.v0', createEventEnvelope({
          type: 'task.operation.rejected',
          source: 'm-task',
          correlationId: suspendedOp.correlationId,
          payload: { opId: suspendedOp.id, action: suspendedOp.action, resource: suspendedOp.resource }
        }))
        return { rejected: true, suspendedOpId: suspendedOp.id }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({ rejected: t.Boolean(), suspendedOpId: t.String() }),
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          501: apiErrorSchema
        }
      }
    )
}

export type MTaskApp = ReturnType<typeof createMTaskApp>
export { createInMemoryMTaskDeps } from './testing.ts'
