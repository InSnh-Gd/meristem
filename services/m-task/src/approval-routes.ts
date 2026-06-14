import { Elysia, t } from 'elysia'
import type { MTask } from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import type { MTaskDeps } from './deps.ts'
import { apiErrorSchema, taskSchema } from './route-schemas.ts'
import { correlationIdFromHeaders } from './task-route-helpers.ts'

/**
 * 审批恢复/拒绝路由维持内部 token、幂等冲突、过期处理和事件发布顺序不变。
 */
export function createApprovalRoutes(deps: MTaskDeps) {
  return new Elysia()
    .post(
      '/internal/v0/task-operations/:id/resume',
      async ({ params, headers, status }) => {
        const internalAuth = validateInternalRequest(headers)
        if (!internalAuth.ok) return status(401, { error: internalAuth.error })

        const auth = correlationIdFromHeaders(headers)
        if (!deps.suspendedOps)
          return status(501, {
            error: { code: 'not_implemented_yet', message: 'suspended operations not supported' }
          })

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp)
          return status(404, {
            error: {
              code: 'task.suspended_op_not_found',
              message: 'suspended operation not found',
              correlationId: auth
            }
          })

        if (suspendedOp.status !== 'suspended') {
          await deps.log.writeFull({
            level: 'warn',
            source: 'm-task',
            message: 'resume attempted on non-suspended operation',
            correlationId: suspendedOp.correlationId,
            payload: { opId: suspendedOp.id, status: suspendedOp.status }
          })
          return status(409, {
            error: {
              code: 'task.resume_conflict',
              message: `operation is ${suspendedOp.status}`,
              correlationId: suspendedOp.correlationId
            }
          })
        }
        if (new Date(suspendedOp.expiresAt) < new Date()) {
          await deps.suspendedOps.transition(suspendedOp.id, 'expired', 'approval_expired')
          await deps.log.writeFull({
            level: 'warn',
            source: 'm-task',
            message: 'resume attempted on expired operation',
            correlationId: suspendedOp.correlationId,
            payload: { opId: suspendedOp.id }
          })
          return status(409, {
            error: {
              code: 'task.resume_expired',
              message: 'suspended operation has expired',
              correlationId: suspendedOp.correlationId
            }
          })
        }

        const resourceParts = suspendedOp.resource.split(':')
        const resourceId = resourceParts[1] ?? ''
        let resultTask: MTask | null = null

        try {
          if (suspendedOp.action === 'task.submit') {
            const payload = suspendedOp.sanitizedPayload as {
              action: string
              resource: string
              risk: import('../../../packages/contracts/src/index.ts').TaskRiskSummary
            }
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
              await deps.suspendedOps.transition(
                suspendedOp.id,
                'resume_failed',
                'target_task_not_found'
              )
              await deps.events.publish(
                'task.operation.resume.failure.v0',
                createEventEnvelope({
                  type: 'task.operation.resume.failure',
                  source: 'm-task',
                  correlationId: suspendedOp.correlationId,
                  payload: { opId: suspendedOp.id, reason: 'target_task_not_found' }
                })
              )
              return status(409, {
                error: {
                  code: 'task.resume_stale',
                  message: 'target task not found',
                  correlationId: suspendedOp.correlationId
                }
              })
            }
            if (suspendedOp.action === 'task.cancel') {
              const terminalStatuses: MTask['status'][] = [
                'completed',
                'failed',
                'canceled',
                'timed_out'
              ]
              if (terminalStatuses.includes(resultTask.status)) {
                await deps.suspendedOps.transition(
                  suspendedOp.id,
                  'resume_failed',
                  'task_in_terminal_state'
                )
                await deps.events.publish(
                  'task.operation.resume.failure.v0',
                  createEventEnvelope({
                    type: 'task.operation.resume.failure',
                    source: 'm-task',
                    correlationId: suspendedOp.correlationId,
                    payload: {
                      opId: suspendedOp.id,
                      reason: 'task_in_terminal_state',
                      taskStatus: resultTask.status
                    }
                  })
                )
                return status(409, {
                  error: {
                    code: 'task.resume_stale',
                    message: `task is in terminal state: ${resultTask.status}`,
                    correlationId: suspendedOp.correlationId
                  }
                })
              }
              resultTask = await deps.storage.transition(resourceId, 'canceled', {
                canceledAt: new Date().toISOString()
              })
            }
            if (suspendedOp.action === 'task.retry') {
              await deps.log.writeFull({
                level: 'warn',
                source: 'm-task',
                message: 'retry resume executed but retry is not implemented',
                correlationId: suspendedOp.correlationId,
                payload: { opId: suspendedOp.id }
              })
            }
          }

          await deps.suspendedOps.transition(suspendedOp.id, 'resumed')
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
                taskId: resultTask?.id
              }
            })
          )

          return { resumed: true, suspendedOpId: suspendedOp.id, task: resultTask }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'resume failed'
          await deps.suspendedOps.transition(
            suspendedOp.id,
            'resume_failed',
            `resume_error: ${message}`
          )
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
          return status(500, {
            error: {
              code: 'task.resume_failed',
              message,
              correlationId: suspendedOp.correlationId
            }
          })
        }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({
            resumed: t.Boolean(),
            suspendedOpId: t.String(),
            task: t.Nullable(taskSchema)
          }),
          401: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
          501: apiErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/task-operations/:id/reject',
      async ({ params, headers, status }) => {
        const internalAuth = validateInternalRequest(headers)
        if (!internalAuth.ok) return status(401, { error: internalAuth.error })

        const correlationId = correlationIdFromHeaders(headers)
        if (!deps.suspendedOps)
          return status(501, {
            error: { code: 'not_implemented_yet', message: 'suspended operations not supported' }
          })

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp)
          return status(404, {
            error: {
              code: 'task.suspended_op_not_found',
              message: 'suspended operation not found',
              correlationId
            }
          })
        if (suspendedOp.status !== 'suspended')
          return status(409, {
            error: {
              code: 'task.reject_conflict',
              message: `operation is ${suspendedOp.status}`,
              correlationId: suspendedOp.correlationId
            }
          })

        await deps.suspendedOps.transition(suspendedOp.id, 'rejected', 'approval_rejected')
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
