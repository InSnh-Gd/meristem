import { err, ok, type Result } from '../../common/src/result.ts'

export type MEventEnvelope = {
  id: string
  type: string
  version: string
  source: string
  timestamp: string
  correlationId?: string
  traceId?: string
  causationId?: string
  subject?: string
  payload: unknown
}

export type CreateEventInput = {
  type: string
  source: string
  payload: unknown
  correlationId?: string
  traceId?: string
  causationId?: string
  subject?: string
}

/**
 * 所有领域事件统一先包装成最小 envelope，避免各服务各自发散字段形状。
 */
export function createEventEnvelope(input: CreateEventInput): MEventEnvelope {
  const event: MEventEnvelope = {
    id: crypto.randomUUID(),
    type: input.type,
    version: 'v0',
    source: input.source,
    timestamp: new Date().toISOString(),
    payload: input.payload
  }
  if (input.correlationId) event.correlationId = input.correlationId
  if (input.traceId) event.traceId = input.traceId
  if (input.causationId) event.causationId = input.causationId
  if (input.subject) event.subject = input.subject
  return event
}

/**
 * 事件校验保持纯函数输出，便于 HTTP 发布入口、测试和未来消费者复用同一套规则。
 */
export function validateEventEnvelope(value: unknown): Result<MEventEnvelope, string[]> {
  if (typeof value !== 'object' || value === null) return err(['event_not_object'])

  const event = value as Partial<MEventEnvelope>
  const errors: string[] = []

  if (typeof event.id !== 'string' || event.id.length === 0) errors.push('missing_id')
  if (typeof event.type !== 'string' || event.type.length === 0) errors.push('missing_type')
  if (typeof event.version !== 'string' || event.version.length === 0) errors.push('missing_version')
  if (typeof event.source !== 'string' || event.source.length === 0) errors.push('missing_source')
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) errors.push('invalid_timestamp')
  if ('traceId' in event && event.traceId !== undefined && typeof event.traceId !== 'string') errors.push('invalid_trace_id')
  if (!('payload' in event)) errors.push('missing_payload')

  return errors.length > 0 ? err(errors) : ok(event as MEventEnvelope)
}
