import { edenTreaty } from '@elysiajs/eden'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createInternalFetcher, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'

export type PolicyEventPublisher = ReturnType<typeof createPolicyEventPublisher>

export function createPolicyEventPublisher() {
  const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), {
    fetcher: createInternalFetcher()
  })

  return {
    async publishDecisionCreated(input: {
      decisionId: string
      actor: string
      action: string
      resource: string
      result: string
      reasons: string[]
      correlationId?: string
      traceId?: string
    }) {
      const traceId = input.traceId ?? currentTraceId()
      const event = createEventEnvelope({
        type: 'policy.decision.created',
        source: 'm-policy',
        payload: {
          decisionId: input.decisionId,
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          result: input.result,
          reasons: input.reasons
        },
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(traceId ? { traceId } : {})
      })
      const publish = await eventBus.internal.v0.publish.post({
        subject: 'policy.decision.created.v0',
        event
      })
      if (publish.error || !publish.data) {
        throw new Error('failed to publish policy.decision.created.v0')
      }
    },
    async publishLog(
      kind: 'timeline' | 'full' | 'audit',
      payload: unknown,
      options?: { traceId?: string }
    ) {
      const traceId = options?.traceId ?? currentTraceId()
      const type = kind === 'audit' ? 'audit.entry.created' : `log.${kind}`
      const subject = kind === 'audit' ? 'audit.entry.created.v0' : `log.${kind}.v0`
      const event = createEventEnvelope({
        type,
        source: 'm-policy',
        payload,
        ...(traceId ? { traceId } : {})
      })
      await eventBus.internal.v0.publish.post({ subject, event })
    },
    async publishSubject(subject: string, payload: unknown) {
      const event = createEventEnvelope({
        type: subject.replace(/\.v0$/, ''),
        source: 'm-policy',
        payload
      })
      await eventBus.internal.v0.publish.post({ subject, event })
    }
  }
}
