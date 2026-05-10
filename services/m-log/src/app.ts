import { Elysia, t } from 'elysia'
import type { AuditLog, FullLog, TimelineLog } from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId, withExtractedSpan } from '../../../packages/telemetry/src/index.ts'

type TimelineWriteInput = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteInput = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteInput = Omit<AuditLog, 'id' | 'timestamp'>
type ReloadInput = {
  correlationId?: string
  reason?: string
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
}

/**
 * M-Log 对内统一暴露 Timeline / Full / Audit 写入与查询，以及生命周期 reload。
 * 这里的 Elysia 方法链必须显式保留 internal token、traceId 补齐和错误映射逻辑。
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
        })
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
        })
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
        })
      }
    )
    .get('/internal/v0/timeline', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.timeline.list', headers, async () => ({ entries: await deps.listTimeline(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric()) })
    })
    .get('/internal/v0/full', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.full.list', headers, async () => ({ entries: await deps.listFull(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric()) })
    })
    .get('/internal/v0/audit', async ({ query, headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan('m-log', 'm-log.audit.list', headers, async () => ({ entries: await deps.listAudit(query.limit) }))
    }, {
      query: t.Object({ limit: t.Optional(t.Numeric()) })
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
      })
    })
}

export type LogApp = ReturnType<typeof createLogApp>
