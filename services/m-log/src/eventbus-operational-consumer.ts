import * as Schema from 'effect/Schema'
import type { NatsConnection } from '@nats-io/nats-core'
import {
  EventBusPublishFailedPayloadSchema,
  EventBusRejectedPayloadSchema,
  type FullLog
} from '../../../packages/contracts/src/index.ts'
import {
  eventBusOperationalSubjects,
  type MEventEnvelope,
  validateEventEnvelope
} from '../../../packages/events/src/index.ts'

type WriteFullPort = (input: Omit<FullLog, 'id' | 'timestamp'>) => Promise<FullLog>

const decodeRejectedPayload = Schema.decodeUnknownSync(EventBusRejectedPayloadSchema)
const decodeFailedPayload = Schema.decodeUnknownSync(EventBusPublishFailedPayloadSchema)

function describeCaller(input: { callerService?: string | undefined; actor?: string | undefined }): string {
  if (input.callerService && input.actor) return ` from ${input.callerService} by ${input.actor}`
  if (input.callerService) return ` from ${input.callerService}`
  if (input.actor) return ` by ${input.actor}`
  return ''
}

/**
 * M-Log 只把 EventBus 操作失败落成 Full Log，避免把传输层失败误写成审计事实或业务状态变更。
 */
export async function handleEventBusOperationalEnvelope(
  subject: (typeof eventBusOperationalSubjects)[number],
  envelope: unknown,
  writeFull: WriteFullPort
): Promise<void> {
  const validated = validateEventEnvelope(envelope)
  if (!validated.ok) {
    throw new Error(`invalid_eventbus_operational_envelope:${validated.error.join(',')}`)
  }

  const event = validated.value
  if (event.subject !== undefined && event.subject !== subject) {
    throw new Error(`eventbus_operational_subject_mismatch:${subject}:${event.subject}`)
  }

  if (subject === 'meventbus.publish.rejected.v0') {
    const payload = decodeRejectedPayload(event.payload)
    await writeFull({
      level: 'warn',
      source: 'm-eventbus',
      message: `EventBus rejected publish for ${payload.failedSubject}${describeCaller(payload)}`,
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.traceId ? { traceId: event.traceId } : {}),
      payload: {
        subject,
        envelopeId: event.id,
        ...payload
      }
    })
    return
  }

  const payload = decodeFailedPayload(event.payload)
  await writeFull({
    level: 'error',
    source: 'm-eventbus',
    message: `EventBus publish failed for ${payload.failedSubject}${describeCaller(payload)}`,
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.traceId ? { traceId: event.traceId } : {}),
    payload: {
      subject,
      envelopeId: event.id,
      ...payload
    }
  })
}

async function consumeEventBusOperationalSubject(
  nc: NatsConnection,
  subject: (typeof eventBusOperationalSubjects)[number],
  writeFull: WriteFullPort
): Promise<void> {
  const subscription = nc.subscribe(subject)
  for await (const message of subscription) {
    try {
      await handleEventBusOperationalEnvelope(subject, message.json<MEventEnvelope>(), writeFull)
    } catch (error) {
      console.warn('[m-log] eventbus_operational_consume_failed', {
        subject,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

/**
 * EventBus 操作主题消费是 M-Log 的旁路观测面，不参与 readiness，也不阻塞主写路径启动。
 */
export function startEventBusOperationalConsumer(
  nc: NatsConnection,
  writeFull: WriteFullPort
): void {
  for (const subject of eventBusOperationalSubjects) {
    void consumeEventBusOperationalSubject(nc, subject, writeFull)
  }
}
