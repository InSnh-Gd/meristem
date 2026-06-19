import type { edenTreaty } from '@elysiajs/eden'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'
import type { LogApp } from '../../m-log/src/public-types.ts'

export type ProfileEvents = {
  publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
}

export type ProfileLog = {
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(level: string, message: string, correlationId?: string, payload?: unknown): Promise<void>
  writeAudit(
    actor: ActorId,
    action: string,
    resource: string,
    result: string,
    correlationId?: string,
    payload?: unknown
  ): Promise<void>
}

type EventBusClient = ReturnType<typeof edenTreaty<EventBusApp>>
type LogClient = ReturnType<typeof edenTreaty<LogApp>>

export function createEventPublisher(eventBus: EventBusClient) {
  return async function publishEvent(
    subject: string,
    type: string,
    payload: unknown,
    correlationId?: string,
    traceId?: string
  ): Promise<void> {
    const event = createEventEnvelope({
      type,
      source: 'm-net',
      payload,
      ...(correlationId ? { correlationId } : {}),
      ...(traceId ? { traceId } : {})
    })
    const response = await eventBus.internal.v0.publish.post({ subject, event })
    if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
  }
}

export function createLogWriters(logService: LogClient) {
  return {
    async writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void> {
      const response = await logService.internal.v0.timeline.post({
        summary,
        ...(subject ? { subject } : {}),
        ...(correlationId ? { correlationId } : {})
      })
      if (response.error || !response.data) throw new Error('failed to write timeline entry')
    },
    async writeFull(
      level: 'debug' | 'info' | 'warn' | 'error',
      message: string,
      correlationId?: string,
      traceId?: string,
      payload?: unknown
    ): Promise<void> {
      const response = await logService.internal.v0.full.post({
        level,
        source: 'm-net',
        message,
        ...(correlationId ? { correlationId } : {}),
        ...(traceId ? { traceId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write full log entry')
    },
    async writeAudit(
      resource: string,
      action: string,
      correlationId?: string,
      traceId?: string,
      payload?: unknown
    ): Promise<void> {
      const response = await logService.internal.v0.audit.post({
        actor: 'system',
        action,
        resource,
        result: 'deny',
        ...(correlationId ? { correlationId } : {}),
        ...(traceId ? { traceId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write audit entry')
    }
  }
}

export function createProfileEventsClient(eventBus: EventBusClient): ProfileEvents {
  return {
    async publish(subject, type, payload, correlationId) {
      const event = createEventEnvelope({
        type,
        source: 'm-net',
        payload,
        ...(correlationId ? { correlationId } : {})
      })
      const response = await eventBus.internal.v0.publish.post({ subject, event })
      if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
    }
  }
}

export function createProfileLogClient(logService: LogClient): ProfileLog {
  return {
    async writeTimeline(summary: string, subject?: string, correlationId?: string) {
      const response = await logService.internal.v0.timeline.post({
        summary,
        ...(subject ? { subject } : {}),
        ...(correlationId ? { correlationId } : {})
      })
      if (response.error || !response.data) throw new Error('failed to write timeline')
    },
    async writeFull(level: string, message: string, correlationId?: string, payload?: unknown) {
      const response = await logService.internal.v0.full.post({
        level: level as 'debug' | 'info' | 'warn' | 'error',
        source: 'm-net',
        message,
        ...(correlationId ? { correlationId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write full log')
    },
    async writeAudit(
      actor: ActorId,
      action: string,
      resource: string,
      result: string,
      correlationId?: string,
      payload?: unknown
    ) {
      const response = await logService.internal.v0.audit.post({
        actor,
        action,
        resource,
        result: result as 'success' | 'failure' | 'deny' | 'pending' | 'allow' | 'canceled',
        ...(correlationId ? { correlationId } : {}),
        ...(payload === undefined ? {} : { payload })
      })
      if (response.error || !response.data) throw new Error('failed to write audit')
    }
  }
}
