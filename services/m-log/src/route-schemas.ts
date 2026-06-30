import { t } from 'elysia'
import { apiErrorRouteSchema } from '../../../packages/contracts/src/index.ts'

export const internalErrorSchema = apiErrorRouteSchema

// /ready 响应包含 opensearch 可用性，满足 projection degraded state 可观测要求。
export const readyResponseSchema = t.Object({
  ready: t.Boolean(),
  opensearch: t.Union([t.Literal('ready'), t.Literal('unavailable')])
})

export const timelineLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.String({ minLength: 1 }),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const fullLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String({ minLength: 1 }),
  message: t.String({ minLength: 1 }),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

export const auditLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('break-glass-reviewer'),
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

export const logSearchResultSchema = <T extends ReturnType<typeof t.Object>>(entrySchema: T) =>
  t.Object({
    entries: t.Array(entrySchema),
    total: t.Number()
  })

export const degradedSearchSchema = apiErrorRouteSchema

export const projectionHealthSchema = t.Object({
  index: t.String(),
  lagSeconds: t.Number(),
  lastProjectedAt: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  dlqCount: t.Number(),
  status: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unavailable')])
})

export const backfillParamsSchema = t.Object({
  index: t.String({ minLength: 1 }),
  from: t.Optional(
    t.Object({
      factId: t.String(),
      timestamp: t.String()
    })
  ),
  to: t.Optional(
    t.Object({
      factId: t.String(),
      timestamp: t.String()
    })
  ),
  batchSize: t.Numeric({ minimum: 1, maximum: 1000 }),
  targetVersion: t.Optional(t.String())
})

export const backfillResultSchema = t.Object({
  jobId: t.String(),
  processedCount: t.Number(),
  errors: t.Number(),
  lastCursor: t.Union([
    t.Object({
      factId: t.String(),
      timestamp: t.String()
    }),
    t.Null()
  ]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('running'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('cancelled')
  ])
})

export const dlqRecordSchema = t.Object({
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

export const fullSearchQuerySchema = t.Object({
  ...baseSearchQuery,
  level: t.Optional(
    t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')])
  ),
  source: t.Optional(t.String()),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String())
})

export const timelineSearchQuerySchema = t.Object({
  ...baseSearchQuery,
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const auditSearchQuerySchema = t.Object({
  ...baseSearchQuery,
  actor: t.Optional(t.String()),
  action: t.Optional(t.String()),
  resource: t.Optional(t.String()),
  decisionId: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const listQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
})

export const reloadBodySchema = t.Object({
  correlationId: t.Optional(t.String()),
  reason: t.Optional(t.String())
})

export const timelineWriteBodySchema = t.Object({
  summary: t.String({ minLength: 1 }),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const fullWriteBodySchema = t.Object({
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String({ minLength: 1 }),
  message: t.String({ minLength: 1 }),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

export const auditWriteBodySchema = t.Object({
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('break-glass-reviewer'),
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
