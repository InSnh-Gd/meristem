import { Elysia, t } from 'elysia'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/helpers.ts'
import { apiError } from '../errors.ts'
import { apiErrorSchema, taskSchema, protectedRouteDetail, protectedResponse } from '../schemas.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'

export function tasksRoutes(deps: CoreDeps) {
  return new Elysia()
    .post('/api/v0/tasks', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.task.assign', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'task:assign', resource: `node:${body.leafNodeId}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response
        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'task:assign',
          resource: `node:${body.leafNodeId}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)
        await deps.events.publish(
          'task.assignment.requested.v0',
          tracedEvent({
            type: 'task.assignment.requested',
            source: 'meristem-core',
            payload: { leafNodeId: body.leafNodeId, type: body.type, actor: auth.actor },
            correlationId: auth.correlationId
          })
        )
        const node = await deps.storage.getNode(body.leafNodeId)
        if (!node) return apiError(status, 404, 'node.not_found', 'node not found', auth.correlationId)
        if (node.kind !== 'leaf') {
          return apiError(status, 409, 'node.invalid_kind', 'target must be a Leaf node', auth.correlationId)
        }
        const task = node.mode === 'simulated'
          ? await deps.storage.assignTask(body)
          : await (async () => {
              if (node.reachability !== 'reachable' || (node.status !== 'healthy' && node.status !== 'degraded')) {
                throw { code: 'node.unreachable', message: 'node is unreachable' }
              }
              const hasCredential = await deps.storage.hasActiveNodeCredential(node.id)
              if (!hasCredential) throw { code: 'node.credential_missing', message: 'node does not have an active credential' }
              const requestedTask = await deps.storage.createTaskRequest(body)
              const executed = await deps.agentTasks.executeNoop({
                nodeId: node.id,
                taskId: requestedTask.id,
                correlationId: auth.correlationId
              })
              if (!executed.ok) throw executed.error
              const completed = await deps.storage.completeTask({
                taskId: requestedTask.id,
                completedAt: executed.value.completedAt
              })
              if (!completed) throw { code: 'task.not_found', message: 'task not found' }
              return completed
            })().catch((error: unknown) => {
              const failure = typeof error === 'object' && error !== null
                ? {
                    code: String(Reflect.get(error, 'code') ?? 'nodeagent.unavailable'),
                    message: String(Reflect.get(error, 'message') ?? 'node agent unavailable')
                  }
                : { code: 'nodeagent.unavailable', message: 'node agent unavailable' }
              return failure
            })
        if ('code' in task) {
          return apiError(status, statusCodeForServiceError(task.code), task.code, task.message, auth.correlationId)
        }
        await deps.events.publish(
          'task.assignment.completed.v0',
          tracedEvent({
            type: 'task.assignment.completed',
            source: 'meristem-core',
            payload: { taskId: task.id, leafNodeId: task.leafNodeId, type: task.type },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `completed noop task ${task.id}`,
          subject: task.id,
          correlationId: auth.correlationId
        })
        return { task, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      })
    }, {
      body: t.Object({ leafNodeId: t.String(), type: t.Literal('noop') }),
      response: protectedResponse(
        t.Object({ task: taskSchema, policyDecisionId: t.String(), correlationId: t.String() }),
        { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Assign a noop task to a leaf node')
    })
    .get('/api/v0/tasks/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `task:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const task = await deps.storage.getTask(params.id)
      return task ? { task } : apiError(status, 404, 'task.not_found', 'task not found', auth.correlationId)
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(t.Object({ task: taskSchema }), { 404: apiErrorSchema }),
      detail: protectedRouteDetail('Read one task')
    })
}
