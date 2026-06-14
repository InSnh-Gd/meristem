import { Elysia, t } from 'elysia'
import { ok } from '../../../packages/common/src/result.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MTaskDeps } from './deps.ts'
import {
  apiErrorSchema,
  policyBlockSchema,
  retryNotImplementedSchema,
  riskSchema,
  taskSchema
} from './route-schemas.ts'
import {
  blockIfNeeded,
  correlationIdFromHeaders,
  decideOrThrow,
  publishTaskEvent,
  requireActor,
  riskFor,
  transitionWithTimeline
} from './task-route-helpers.ts'

/**
 * 公开任务路由保留原有 URL、鉴权、策略、日志与事件顺序，只把实现从 facade 挪出。
 */
export function createPublicTaskRoutes(deps: MTaskDeps) {
  return new Elysia()
    .get('/api/v0/task-definitions', async ({ headers }) => {
      await requireActor(deps, headers)
      return { taskDefinitions: [{ type: 'noop' as const, version: 'v0', timeoutSeconds: 30 }] }
    })
    .get(
      '/api/v0/tasks',
      async ({ headers }) => {
        await requireActor(deps, headers)
        return { tasks: await deps.storage.list() }
      },
      {
        response: { 200: t.Object({ tasks: t.Array(taskSchema) }), 401: apiErrorSchema }
      }
    )
    .post(
      '/api/v0/tasks',
      async ({ body, headers, status }) =>
        withExtractedSpan('m-task', 'm-task.task.submit', headers, async () => {
          const auth = await requireActor(deps, headers)
          const risk = riskFor({ action: 'task:submit', type: body.type })
          const decision = await decideOrThrow(deps, {
            actor: auth.actor,
            action: 'task:submit',
            resource: `node:${body.nodeId}`,
            risk,
            correlationId: auth.correlationId
          })
          const blocked = await blockIfNeeded(deps, {
            actor: auth.actor,
            action: 'task:submit',
            resource: `node:${body.nodeId}`,
            decision,
            risk,
            correlationId: auth.correlationId
          })
          if (blocked) return status(blocked.status, blocked.body)

          await deps.log.writeAudit({
            actor: auth.actor,
            action: 'task.submit',
            resource: `node:${body.nodeId}`,
            decisionId: decision.decisionId,
            result: decision.result,
            correlationId: auth.correlationId,
            payload: { risk }
          })
          const accepted = await deps.storage.create({
            ...body,
            actor: auth.actor,
            correlationId: auth.correlationId,
            policyDecisionId: decision.decisionId,
            risk
          })
          await publishTaskEvent(
            deps,
            'task.requested.v0',
            'task.requested',
            accepted,
            auth.correlationId
          )
          const queued = await transitionWithTimeline(
            deps,
            accepted.id,
            'queued',
            auth.correlationId
          )
          await publishTaskEvent(deps, 'task.queued.v0', 'task.queued', queued, auth.correlationId)

          const delivered = await deps.delivery.submitDelivery({
            nodeId: queued.nodeId,
            taskId: queued.id,
            correlationId: auth.correlationId
          })
          if (!delivered.ok) {
            const failed = await transitionWithTimeline(
              deps,
              queued.id,
              'failed',
              auth.correlationId
            )
            await deps.log.writeFull({
              level: 'warn',
              source: 'm-task',
              message: delivered.error.message,
              correlationId: auth.correlationId,
              payload: { taskId: failed.id }
            })
            await publishTaskEvent(
              deps,
              'task.failed.v0',
              'task.failed',
              failed,
              auth.correlationId
            )
            return {
              task: failed,
              policyDecisionId: decision.decisionId,
              correlationId: auth.correlationId,
              risk
            }
          }
          if ('queued' in delivered.value) {
            return {
              task: queued,
              policyDecisionId: decision.decisionId,
              correlationId: auth.correlationId,
              risk
            }
          }

          const dispatched = await transitionWithTimeline(
            deps,
            queued.id,
            'dispatched',
            auth.correlationId
          )
          await publishTaskEvent(
            deps,
            'task.dispatched.v0',
            'task.dispatched',
            dispatched,
            auth.correlationId
          )
          const running = await transitionWithTimeline(
            deps,
            queued.id,
            'running',
            auth.correlationId
          )
          await publishTaskEvent(
            deps,
            'task.running.v0',
            'task.running',
            running,
            auth.correlationId
          )
          const completed = await transitionWithTimeline(
            deps,
            queued.id,
            'completed',
            auth.correlationId,
            { completedAt: delivered.value.completedAt }
          )
          await publishTaskEvent(
            deps,
            'task.completed.v0',
            'task.completed',
            completed,
            auth.correlationId
          )
          return {
            task: completed,
            policyDecisionId: decision.decisionId,
            correlationId: auth.correlationId,
            risk
          }
        }),
      {
        body: t.Object({
          nodeId: t.String({ minLength: 1 }),
          type: t.Literal('noop'),
          timeoutAt: t.Optional(t.String())
        }),
        response: {
          200: t.Object({
            task: taskSchema,
            policyDecisionId: t.String(),
            correlationId: t.String(),
            risk: riskSchema
          }),
          401: apiErrorSchema,
          403: policyBlockSchema,
          409: policyBlockSchema
        }
      }
    )
    .get(
      '/api/v0/tasks/:id',
      async ({ params, headers }) => {
        await requireActor(deps, headers)
        const task = await deps.storage.get(params.id)
        if (!task)
          throw Object.assign(new Error('task not found'), {
            status: 404,
            code: 'task.not_found',
            correlationId: correlationIdFromHeaders(headers)
          })
        return { task }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({ task: taskSchema }),
          401: apiErrorSchema,
          404: apiErrorSchema
        }
      }
    )
    .post(
      '/api/v0/tasks/:id/cancel',
      async ({ params, headers, status }) => {
        const auth = await requireActor(deps, headers)
        const risk = riskFor({ action: 'task:cancel', type: 'noop' })
        const decision = await decideOrThrow(deps, {
          actor: auth.actor,
          action: 'task:cancel',
          resource: `task:${params.id}`,
          risk,
          correlationId: auth.correlationId
        })
        const blocked = await blockIfNeeded(deps, {
          actor: auth.actor,
          action: 'task:cancel',
          resource: `task:${params.id}`,
          decision,
          risk,
          correlationId: auth.correlationId
        })
        if (blocked) return status(blocked.status, blocked.body)

        await deps.log.writeAudit({
          actor: auth.actor,
          action: 'task.cancel',
          resource: `task:${params.id}`,
          decisionId: decision.decisionId,
          result: decision.result,
          correlationId: auth.correlationId,
          payload: { risk }
        })
        const existing = await deps.storage.get(params.id)
        if (!existing)
          throw Object.assign(new Error('task not found'), {
            status: 404,
            code: 'task.not_found',
            correlationId: auth.correlationId
          })
        if (['completed', 'failed', 'timed_out', 'canceled'].includes(existing.status)) {
          throw Object.assign(new Error('terminal tasks cannot be canceled'), {
            status: 409,
            code: 'task.terminal',
            correlationId: auth.correlationId
          })
        }

        const delivery =
          existing.status === 'queued'
            ? ok<'cancelAccepted'>('cancelAccepted')
            : await deps.delivery.cancelDelivery({
                taskId: existing.id,
                correlationId: auth.correlationId
              })
        if (!delivery.ok || delivery.value === 'cancelRejected') {
          await deps.log.writeFull({
            level: 'warn',
            source: 'm-task',
            message: 'cancelRejected',
            correlationId: auth.correlationId,
            payload: { taskId: existing.id }
          })
          return {
            task: existing,
            policyDecisionId: decision.decisionId,
            correlationId: auth.correlationId,
            risk
          }
        }

        const canceled = await transitionWithTimeline(
          deps,
          existing.id,
          'canceled',
          auth.correlationId,
          { canceledAt: new Date().toISOString() }
        )
        await publishTaskEvent(
          deps,
          'task.canceled.v0',
          'task.canceled',
          canceled,
          auth.correlationId
        )
        return {
          task: canceled,
          policyDecisionId: decision.decisionId,
          correlationId: auth.correlationId,
          risk
        }
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({
            task: taskSchema,
            policyDecisionId: t.String(),
            correlationId: t.String(),
            risk: riskSchema
          }),
          401: apiErrorSchema,
          403: policyBlockSchema,
          404: apiErrorSchema,
          409: policyBlockSchema
        }
      }
    )
    .post(
      '/api/v0/tasks/:id/retry',
      async ({ params, headers, status }) => {
        const auth = await requireActor(deps, headers)
        const risk = riskFor({ action: 'task:retry', type: 'noop' })
        const decision = await decideOrThrow(deps, {
          actor: auth.actor,
          action: 'task:retry',
          resource: `task:${params.id}`,
          risk,
          correlationId: auth.correlationId
        })
        const blocked = await blockIfNeeded(deps, {
          actor: auth.actor,
          action: 'task:retry',
          resource: `task:${params.id}`,
          decision,
          risk,
          correlationId: auth.correlationId
        })
        if (blocked) return status(blocked.status, blocked.body)

        await deps.log.writeFull({
          level: 'warn',
          source: 'm-task',
          message: 'retry is not implemented',
          correlationId: auth.correlationId,
          payload: { taskId: params.id, decisionId: decision.decisionId, risk }
        })
        return status(501, {
          error: { code: 'not_implemented_yet', message: 'retry is not implemented' },
          decisionId: decision.decisionId,
          risk
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          401: apiErrorSchema,
          403: policyBlockSchema,
          409: policyBlockSchema,
          501: retryNotImplementedSchema
        }
      }
    )
}
