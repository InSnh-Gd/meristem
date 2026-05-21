import { Elysia, t } from 'elysia'
import type { AuditLog, FullLog, FullLogSearchQuery, AuditSearchQuery, LogSearchResult, TimelineLog, TimelineSearchQuery } from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId, withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

type TimelineWriteInput = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteInput = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteInput = Omit<AuditLog, 'id' | 'timestamp'>
type ReloadInput = {
  correlationId?: string
  reason?: string
}

// Phase 10 搜索端口：M-Log 内部 search deps，由 Core 通过内部 HTTP 调用。
export type SearchDeps = {
  full(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null>
  timeline(query: TimelineSearchQuery): Promise<LogSearchResult<TimelineLog> | null>
  audit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null>
  isAvailable(): boolean
}

export type LogAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  writeTimeline(input: TimelineWriteInput): Promise<TimelineLog>
  writeFull(input: FullWriteInput): Promise<FullLog>
  writeAudit(input: AuditWriteInput): Promise<AuditLog>
  listTimeline(limit?: number): Promise<TimelineLog[]>
  listFull(limit?: number): Promise<FullLog[]>
  listAudit(limit?: number): Promise<AuditLog[]>
  reload(input: ReloadInput): Promise<{ serviceId: string; reloadedAt: string }>
  // Phase 10
  search: SearchDeps
}

const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

const timelineLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.String({ minLength: 1 }),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

const fullLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String({ minLength: 1 }),
  message: t.String({ minLength: 1 }),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

const auditLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('system')
  ]),
  action: t.String({ minLength: 1 }),
  resource: t.String({ minLength: 1 }),
  decisionId: t.Optional(t.String()),
  result: t.String({ minLength: 1 }),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

const logSearchResultSchema = <T extends ReturnType<typeof t.Object>>(entrySchema: T) =>
  t.Object({
    entries: t.Array(entrySchema),
    total: t.Number()
  })

const degradedSearchSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

/**
 * 搜索 query schema: 通用字段 + 各类型特有字段。
 * unknown query fields 由 Elysia 自动拒绝（不在 schema 中的 key 会触发验证错误）。
 */
const baseSearchQuery = {
  q: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
}

const fullSearchQuery = t.Object({
  ...baseSearchQuery,
  level: t.Optional(t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')])),
  source: t.Optional(t.String()),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String())
})

const timelineSearchQuery = t.Object({
  ...baseSearchQuery,
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

const auditSearchQuery = t.Object({
  ...baseSearchQuery,
  actor: t.Optional(t.String()),
  action: t.Optional(t.String()),
  resource: t.Optional(t.String()),
  decisionId: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

/**
 * M-Log 对内统一暴露 Timeline / Full / Audit 写入、查询、搜索，以及生命周期 reload。
 * Phase 10 新增内部搜索路由：GET /internal/v0/search/full|timeline|audit。
 */
export function createLogApp(deps: LogAppDeps) {
  return new Elysia()
    .get('/health', () => ({ ok: true as const, service: 'm-log' as const }))
    .get('/ready', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.ready', headers, () => deps.readiness())
    })
    .post(
      '/internal/v0/timeline',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.timeline.write', headers, async () => ({
          entry: await deps.writeTimeline(body)
        }))
      },
      {
        body: t.Object({
          summary: t.String({ minLength: 1 }),
          subject: t.Optional(t.String()),
          correlationId: t.Optional(t.String())
        }),
        response: {
          200: t.Object({ entry: timelineLogSchema }),
          401: internalErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/full',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.full.write', headers, async () => ({
          entry: await (() => {
            const traceId = body.traceId ?? currentTraceId()
            return deps.writeFull(traceId ? { ...body, traceId } : body)
          })()
        }))
      },
      {
        body: t.Object({
          level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
          source: t.String({ minLength: 1 }),
          message: t.String({ minLength: 1 }),
          correlationId: t.Optional(t.String()),
          traceId: t.Optional(t.String()),
          payload: t.Optional(t.Unknown())
        }),
        response: {
          200: t.Object({ entry: fullLogSchema }),
          401: internalErrorSchema
        }
      }
    )
    .post(
      '/internal/v0/audit',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })
        return withExtractedSpan('m-log', 'm-log.audit.write', headers, async () => ({
          entry: await (() => {
            const traceId = body.traceId ?? currentTraceId()
            return deps.writeAudit(traceId ? { ...body, traceId } : body)
          })()
        }))
      },
      {
        body: t.Object({
          actor: t.Union([
            t.Literal('viewer'),
            t.Literal('operator'),
            t.Literal('admin'),
            t.Literal('security-admin'),
            t.Literal('system')
          ]),
          action: t.String({ minLength: 1 }),
          resource: t.String({ minLength: 1 }),
          decisionId: t.Optional(t.String()),
          result: t.String({ minLength: 1 }),
          correlationId: t.Optional(t.String()),
          traceId: t.Optional(t.String()),
          payload: t.Optional(t.Unknown())
        }),
        response: {
          200: t.Object({ entry: auditLogSchema }),
          401: internalErrorSchema
        }
      }
    )
    .get('/internal/v0/timeline', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.timeline.list', headers, async () => ({ entries: await deps.listTimeline(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }),
      response: {
        200: t.Object({ entries: t.Array(timelineLogSchema) }),
        401: internalErrorSchema
      }
    })
    .get('/internal/v0/full', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.full.list', headers, async () => ({ entries: await deps.listFull(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }),
      response: {
        200: t.Object({ entries: t.Array(fullLogSchema) }),
        401: internalErrorSchema
      }
    })
    .get('/internal/v0/audit', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.audit.list', headers, async () => ({ entries: await deps.listAudit(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }),
      response: {
        200: t.Object({ entries: t.Array(auditLogSchema) }),
        401: internalErrorSchema
      }
    })
    .post('/internal/v0/lifecycle/reload', async ({ body, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.lifecycle.reload', headers, async () => {
        try {
          return await deps.reload(body)
        } catch (error) {
          return status(503, {
            error: {
              code: 'service.reload_failed',
              message: error instanceof Error ? error.message : 'service reload failed'
            }
          })
        }
      })
    }, {
      body: t.Object({
        correlationId: t.Optional(t.String()),
        reason: t.Optional(t.String())
      }),
      response: {
        200: t.Object({
          serviceId: t.String(),
          reloadedAt: t.String()
        }),
        401: internalErrorSchema,
        503: internalErrorSchema
      }
    })
    // Phase 10 内部搜索路由：M-Log 拥有 OpenSearch 查询语义。
    // OpenSearch 不可用时返回 503 degraded。
    .get('/internal/v0/search/full', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.search.isAvailable()) {
        return status(503, { error: { code: 'search_unavailable', message: 'OpenSearch is not available' } })
      }
      const result = await deps.search.full({
        ...(query.q ? { q: query.q } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
        ...(query.level ? { level: query.level as FullLog['level'] } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        ...(query.traceId ? { traceId: query.traceId } : {})
      })
      if (!result) {
        return status(503, { error: { code: 'search_unavailable', message: 'search query failed' } })
      }
      return result
    }, {
      query: fullSearchQuery,
      response: {
        200: logSearchResultSchema(fullLogSchema),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    .get('/internal/v0/search/timeline', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.search.isAvailable()) {
        return status(503, { error: { code: 'search_unavailable', message: 'OpenSearch is not available' } })
      }
      const result = await deps.search.timeline({
        ...(query.q ? { q: query.q } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {})
      })
      if (!result) {
        return status(503, { error: { code: 'search_unavailable', message: 'search query failed' } })
      }
      return result
    }, {
      query: timelineSearchQuery,
      response: {
        200: logSearchResultSchema(timelineLogSchema),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    .get('/internal/v0/search/audit', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.search.isAvailable()) {
        return status(503, { error: { code: 'search_unavailable', message: 'OpenSearch is not available' } })
      }
      const result = await deps.search.audit({
        ...(query.q ? { q: query.q } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
        ...(query.actor ? { actor: query.actor } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.resource ? { resource: query.resource } : {}),
        ...(query.decisionId ? { decisionId: query.decisionId } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {})
      })
      if (!result) {
        return status(503, { error: { code: 'search_unavailable', message: 'search query failed' } })
      }
      return result
    }, {
      query: auditSearchQuery,
      response: {
        200: logSearchResultSchema(auditLogSchema),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
}

export type LogApp = ReturnType<typeof createLogApp>
