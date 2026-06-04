import { Elysia, t } from 'elysia'
import type { AuditLog, FullLog, FullLogSearchQuery, AuditSearchQuery, LogSearchResult, TimelineLog, TimelineSearchQuery, ProjectionHealth, BackfillParams, BackfillResult, DLQRecord } from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId, withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

type TimelineWriteInput = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteInput = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteInput = Omit<AuditLog, 'id' | 'timestamp'>
type ReloadInput = {
  correlationId?: string
  reason?: string
}

// 搜索端口：M-Log 内部 search deps，由 Core 通过内部 HTTP 调用。
export type SearchDeps = {
  full(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null>
  timeline(query: TimelineSearchQuery): Promise<LogSearchResult<TimelineLog> | null>
  audit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null>
  isAvailable(): boolean
}

// 投影端口：projection engine 暴露给 API 层的操作。
export type ProjectionDeps = {
  getProjectionHealth(): Promise<ProjectionHealth[]>
  executeBackfill(params: BackfillParams): Promise<BackfillResult>
  listDLQ(index?: string): Promise<DLQRecord[]>
  replayDLQ(dlqId: string): Promise<boolean>
  skipDLQ(dlqId: string): Promise<void>
  isAvailable(): boolean
}

export type LogAppDeps = {
  readiness(): Promise<{ ready: boolean; opensearch: 'ready' | 'unavailable' }>
  writeTimeline(input: TimelineWriteInput): Promise<TimelineLog>
  writeFull(input: FullWriteInput): Promise<FullLog>
  writeAudit(input: AuditWriteInput): Promise<AuditLog>
  listTimeline(limit?: number): Promise<TimelineLog[]>
  listFull(limit?: number): Promise<FullLog[]>
  listAudit(limit?: number): Promise<AuditLog[]>
  reload(input: ReloadInput): Promise<{ serviceId: string; reloadedAt: string }>
  search: SearchDeps
  projection: ProjectionDeps
}

const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

// /ready 响应包含 opensearch 可用性，满足 projection degraded state 可观测要求。
const readyResponseSchema = t.Object({
  ready: t.Boolean(),
  opensearch: t.Union([t.Literal('ready'), t.Literal('unavailable')])
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

// ---- projection schemas ----

const projectionHealthSchema = t.Object({
  index: t.String(),
  lagSeconds: t.Number(),
  lastProjectedAt: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  dlqCount: t.Number(),
  status: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unavailable')])
})

const backfillParamsSchema = t.Object({
  index: t.String({ minLength: 1 }),
  from: t.Optional(t.Object({
    factId: t.String(),
    timestamp: t.String()
  })),
  to: t.Optional(t.Object({
    factId: t.String(),
    timestamp: t.String()
  })),
  batchSize: t.Numeric({ minimum: 1, maximum: 1000 }),
  targetVersion: t.Optional(t.String())
})

const backfillResultSchema = t.Object({
  jobId: t.String(),
  processedCount: t.Number(),
  errors: t.Number(),
  lastCursor: t.Union([t.Object({
    factId: t.String(),
    timestamp: t.String()
  }), t.Null()]),
  status: t.Union([t.Literal('pending'), t.Literal('running'), t.Literal('completed'), t.Literal('failed'), t.Literal('cancelled')])
})

const dlqRecordSchema = t.Object({
  id: t.String(),
  jobId: t.String(),
  factId: t.String(),
  index: t.String(),
  error: t.String(),
  attemptedAt: t.Array(t.String()),
  retries: t.Number(),
  createdAt: t.String()
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
 * M-Log 对内统一暴露 Timeline / Full / Audit 写入、查询、搜索、投影健康、backfill、DLQ，以及生命周期 reload。
 */
export function createLogApp(deps: LogAppDeps) {
  return new Elysia()
    .get('/health', () => ({ ok: true as const, service: 'm-log' as const, opensearch: deps.search.isAvailable() ? ('ready' as const) : ('unavailable' as const) }))
    .get('/ready', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.ready', headers, () => deps.readiness())
    }, {
      response: {
        200: readyResponseSchema,
        401: internalErrorSchema
      }
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
    // 内部搜索路由
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
    // ---- 投影路由 ----
    // §2.6 投影健康端点：lagSeconds、lastProjectedAt、pendingCount
    .get('/internal/v0/projection/health', async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.projection.isAvailable()) {
        return status(503, { error: { code: 'projection_unavailable', message: 'projection engine is not available' } })
      }
      const health = await deps.projection.getProjectionHealth()
      return { indices: health }
    }, {
      response: {
        200: t.Object({ indices: t.Array(projectionHealthSchema) }),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    // §2.5 Backfill 端点：通过内部 HTTP 触发 full-text 重建
    .post('/internal/v0/projection/backfill', async ({ body, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.projection.isAvailable()) {
        return status(503, { error: { code: 'projection_unavailable', message: 'projection engine is not available' } })
      }
      try {
        const params: BackfillParams = {
          index: body.index,
          from: body.from ?? null,
          to: body.to ?? null,
          batchSize: Number(body.batchSize),
          ...(body.targetVersion ? { targetVersion: body.targetVersion } : {})
        }
        const result = await deps.projection.executeBackfill(params)
        return result
      } catch (error) {
        return status(503, {
          error: {
            code: 'backfill_failed',
            message: error instanceof Error ? error.message : 'backfill failed'
          }
        })
      }
    }, {
      body: backfillParamsSchema,
      response: {
        200: backfillResultSchema,
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    // §2.4 DLQ 列表查询
    .get('/internal/v0/projection/dlq', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.projection.isAvailable()) {
        return status(503, { error: { code: 'projection_unavailable', message: 'projection engine is not available' } })
      }
      const records = await deps.projection.listDLQ(query.index)
      return { records }
    }, {
      query: t.Object({ index: t.Optional(t.String()) }),
      response: {
        200: t.Object({ records: t.Array(dlqRecordSchema) }),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    // §2.4 DLQ 手动重放
    .post('/internal/v0/projection/dlq/:id/replay', async ({ params, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.projection.isAvailable()) {
        return status(503, { error: { code: 'projection_unavailable', message: 'projection engine is not available' } })
      }
      const success = await deps.projection.replayDLQ(params.id)
      if (!success) {
        return status(404, { error: { code: 'dlq_not_found_or_replay_failed', message: 'DLQ record not found or replay failed' } })
      }
      return { replayed: true }
    }, {
      response: {
        200: t.Object({ replayed: t.Boolean() }),
        401: internalErrorSchema,
        404: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
    // §2.4 DLQ 逐条跳过
    .post('/internal/v0/projection/dlq/:id/skip', async ({ params, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      if (!deps.projection.isAvailable()) {
        return status(503, { error: { code: 'projection_unavailable', message: 'projection engine is not available' } })
      }
      await deps.projection.skipDLQ(params.id)
      return { skipped: true }
    }, {
      response: {
        200: t.Object({ skipped: t.Boolean() }),
        401: internalErrorSchema,
        503: degradedSearchSchema
      }
    })
}

export type LogApp = ReturnType<typeof createLogApp>
