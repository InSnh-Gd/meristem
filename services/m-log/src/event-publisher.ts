import { edenTreaty } from '@elysiajs/eden'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createInternalFetcher, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'

export function createLogEventPublisher() {
  const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), {
    fetcher: createInternalFetcher()
  })

  return {
    async publishAuditCreated(input: {
      auditId: string
      actor: string
      action: string
      resource: string
      decisionId?: string
      correlationId?: string
      traceId?: string
    }) {
      const traceId = input.traceId ?? currentTraceId()
      const event = createEventEnvelope({
        type: 'audit.entry.created',
        source: 'm-log',
        payload: {
          auditId: input.auditId,
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          decisionId: input.decisionId
        },
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(traceId ? { traceId } : {})
      })
      const publish = await eventBus.internal.v0.publish.post({
        subject: 'audit.entry.created.v0',
        event
      })
      if (publish.error || !publish.data) {
        throw new Error('failed to publish audit.entry.created.v0')
      }
    }
  }
}
