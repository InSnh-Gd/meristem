import type {
  AuditSearchQuery,
  BackfillParams,
  FullLog,
  FullLogSearchQuery,
  TimelineSearchQuery
} from '../../../packages/contracts/src/index.ts'

type FullSearchRouteQuery = {
  q?: string
  from?: string
  to?: string
  limit?: string | number
  level?: FullLog['level']
  source?: string
  correlationId?: string
  traceId?: string
}

type TimelineSearchRouteQuery = {
  q?: string
  from?: string
  to?: string
  limit?: string | number
  subject?: string
  correlationId?: string
}

type AuditSearchRouteQuery = {
  q?: string
  from?: string
  to?: string
  limit?: string | number
  actor?: string
  action?: string
  resource?: string
  decisionId?: string
  correlationId?: string
}

type BackfillRouteBody = {
  index: string
  from?: { factId: string; timestamp: string }
  to?: { factId: string; timestamp: string }
  batchSize: string | number
  targetVersion?: string
}

/**
 * 搜索 query 归一化保持原有字段透传与 Number(limit) 行为，避免拆分后出现语义偏移。
 */
export function toFullSearchQuery(query: FullSearchRouteQuery): FullLogSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.traceId ? { traceId: query.traceId } : {})
  }
}

export function toTimelineSearchQuery(query: TimelineSearchRouteQuery): TimelineSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {})
  }
}

export function toAuditSearchQuery(query: AuditSearchRouteQuery): AuditSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.actor ? { actor: query.actor } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.resource ? { resource: query.resource } : {}),
    ...(query.decisionId ? { decisionId: query.decisionId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {})
  }
}

export function toBackfillParams(body: BackfillRouteBody): BackfillParams {
  return {
    index: body.index,
    from: body.from ?? null,
    to: body.to ?? null,
    batchSize: Number(body.batchSize),
    ...(body.targetVersion ? { targetVersion: body.targetVersion } : {})
  }
}
