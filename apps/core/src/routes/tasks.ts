import { Elysia, t } from 'elysia'
import { CoreError } from '../core-error.ts'
import { Effect } from 'effect'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/helpers.ts'
import { apiErrorSchema, taskSchema, protectedRouteDetail, protectedResponse } from '../schemas.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'

export function tasksRoutes(deps: CoreDeps) {
  return new Elysia()
    .post('/api/v0/tasks', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.task.assign', headers, async () => {
        const auth = await requireActor(deps, headers)
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'task:assign', resource: `node:${body.leafNodeId}`, correlationId: auth.correlationId },
        )
        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'task:assign',
          resource: `node:${body.leafNodeId}`,
          decisionId: permission.id,
          result: permission.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) throw new CoreError(503, audit.error.code, audit.error.message, auth.correlationId)
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
        if (!node) throw new CoreError(404, 'node.not_found', 'node not found', auth.correlationId)
        if (node.kind !== 'leaf') {
          throw new CoreError(409, 'node.invalid_kind', 'target must be a Leaf node', auth.correlationId)
        }
        const task = node.mode === 'simulated'
          ? await deps.storage.assignTask(body)
          : await Effect.runPromise(
              Effect.gen(function* () {
                if (node.reachability !== 'reachable' || (node.status !== 'healthy' && node.status !== 'degraded')) {
                  return yield* Effect.fail({ code: 'node.unreachable', message: 'node is unreachable' })
                }
                const hasCredential = yield* Effect.tryPromise({
                  try: () => deps.storage.hasActiveNodeCredential(node.id),
                  catch: () => ({ code: 'nodeagent.unavailable', message: 'node agent unavailable' })
                })
                if (!hasCredential) {
                  return yield* Effect.fail({ code: 'node.credential_missing', message: 'node does not have an active credential' })
                }
                const requestedTask = yield* Effect.tryPromise({
                  try: () => deps.storage.createTaskRequest(body),
                  catch: () => ({ code: 'nodeagent.unavailable', message: 'node agent unavailable' })
                })
                const executed = yield* Effect.tryPromise({
                  try: () => deps.agentTasks.executeNoop({
                    nodeId: node.id,
                    taskId: requestedTask.id,
                    correlationId: auth.correlationId
                  }),
                  catch: () => ({ code: 'nodeagent.unavailable', message: 'node agent unavailable' })
                })
                if (!executed.ok) {
                  return yield* Effect.fail(executed.error)
                }
                const completed = yield* Effect.tryPromise({
                  try: () => deps.storage.completeTask({
                    taskId: requestedTask.id,
                    completedAt: executed.value.completedAt
                  }),
                  catch: () => ({ code: 'nodeagent.unavailable', message: 'node agent unavailable' })
                })
                if (!completed) {
                  return yield* Effect.fail({ code: 'task.not_found', message: 'task not found' })
                }
                return completed
              }).pipe(
                Effect.catchAll((failure) => Effect.succeed(failure))
              )
            )
        if ('code' in task) {
          throw new CoreError(statusCodeForServiceError(task.code), task.code, task.message, auth.correlationId)
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
        return { task, policyDecisionId: permission.id, correlationId: auth.correlationId }
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
      const auth = await requireActor(deps, headers)
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `task:${params.id}`, correlationId: auth.correlationId },
      )
      const task = await deps.storage.getTask(params.id)
      if (!task) throw new CoreError(404, 'task.not_found', 'task not found', auth.correlationId)
      return { task }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(t.Object({ task: taskSchema }), { 404: apiErrorSchema }),
      detail: protectedRouteDetail('Read one task')
    })
}
