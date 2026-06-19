import { Elysia, t } from 'elysia'
import { apiErrorRouteSchema, type EventBusPublishMetricsSummaryFromSchema } from '../../../packages/contracts/src/index.ts'
import { type MEventEnvelope, validateEventEnvelope } from '../../../packages/events/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { EventBusRejectReason } from './publisher.ts'

type PublishErrorCode = 'subject_not_allowed' | 'subject_mismatch' | 'publish_failed'

function readPublishErrorCode(error: unknown): PublishErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return code === 'subject_not_allowed' || code === 'subject_mismatch' || code === 'publish_failed'
    ? code
    : undefined
}

function readPublishErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'publish_failed'
}

export type EventBusAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  publishMetricsSummary(): EventBusPublishMetricsSummaryFromSchema
  publish(subject: string, event: MEventEnvelope): Promise<{ eventId: string }>
  reportRejected(input: {
    subject: string
    event: unknown
    reason: EventBusRejectReason
    errors: string[]
  }): Promise<void>
}

const internalErrorSchema = apiErrorRouteSchema

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
    .get('/internal/v0/metrics/publish-summary', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-eventbus', 'm-eventbus.publish-metrics', headers, () =>
        Promise.resolve(deps.publishMetricsSummary())
      )
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
            await deps.reportRejected({
              subject: body.subject,
              event: body.event,
              reason: 'invalid_envelope',
              errors: validation.error
            })
            return status(422, {
              error: { code: 'event.invalid', message: validation.error.join(',') }
            })
          }

          if (validation.value.subject !== undefined && validation.value.subject !== body.subject) {
            const errors = ['subject_mismatch']
            await deps.reportRejected({
              subject: body.subject,
              event: validation.value,
              reason: 'subject_mismatch',
              errors
            })
            return status(422, {
              error: { code: 'event.subject_mismatch', message: errors.join(',') }
            })
          }

          try {
            return await deps.publish(body.subject, validation.value)
          } catch (error) {
            const code = readPublishErrorCode(error)
            const message = readPublishErrorMessage(error)

            if (code) {
              if (code === 'subject_not_allowed') {
                await deps.reportRejected({
                  subject: body.subject,
                  event: validation.value,
                  reason: 'subject_not_allowed',
                  errors: [message]
                })
                return status(422, {
                  error: { code: 'event.subject_not_allowed', message }
                })
              }
              if (code === 'subject_mismatch') {
                await deps.reportRejected({
                  subject: body.subject,
                  event: validation.value,
                  reason: 'subject_mismatch',
                  errors: [message]
                })
                return status(422, {
                  error: { code: 'event.subject_mismatch', message }
                })
              }
              return status(503, {
                error: { code: 'event.publish_failed', message }
              })
            }
            return status(503, {
              error: { code: 'event.publish_failed', message: 'publish_failed' }
            })
          }
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
          422: internalErrorSchema,
          503: internalErrorSchema
        }
      }
    )
}

export type EventBusApp = ReturnType<typeof createEventBusApp>
