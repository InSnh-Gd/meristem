import { Elysia, t } from 'elysia'
import { validateEventEnvelope, type MEventEnvelope } from '../../../packages/events/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

export type EventBusAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  publish(subject: string, event: MEventEnvelope): Promise<{ eventId: string }>
}

const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

/**
 * M-EventBus 对内只暴露发布入口，不允许上游绕过 envelope 校验直接向 NATS 写裸消息。
 */
export function createEventBusApp(deps: EventBusAppDeps) {
  return new Elysia()
    .get('/health', () => ({ ok: true as const, service: 'm-eventbus' as const }))
    .get('/ready', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-eventbus', 'm-eventbus.ready', headers, () => deps.readiness())
    })
    .post(
      '/internal/v0/publish',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        // 发布链必须先校验 internal token，再校验 event envelope，避免无类型或未授权事件进总线。
        return withExtractedSpan('m-eventbus', 'm-eventbus.publish', headers, async () => {
          const validation = validateEventEnvelope(body.event)
          if (!validation.ok) {
            return status(422, { error: { code: 'event.invalid', message: validation.error.join(',') } })
          }
          return deps.publish(body.subject, validation.value)
        })
      },
      {
        body: t.Object({
          subject: t.String({ minLength: 1 }),
          event: t.Object({
            id: t.String(),
            type: t.String(),
            version: t.String(),
            source: t.String(),
            timestamp: t.String(),
            correlationId: t.Optional(t.String()),
            traceId: t.Optional(t.String()),
            causationId: t.Optional(t.String()),
            subject: t.Optional(t.String()),
            payload: t.Unknown()
          })
        }),
        response: {
          200: t.Object({
            eventId: t.String()
          }),
          401: internalErrorSchema,
          422: internalErrorSchema
        }
      }
    )
}

export type EventBusApp = ReturnType<typeof createEventBusApp>
