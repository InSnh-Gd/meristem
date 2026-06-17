import { Elysia, t } from 'elysia'
import {
  apiErrorSchema,
  auditLogSchema,
  fullLogSchema,
  protectedResponse,
  protectedRouteDetail,
  timelineLogSchema
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  requireLogAccess,
  toAuditSearchQuery,
  toFullLogSearchQuery,
  toTimelineSearchQuery,
  unwrapLogResult
} from './logs-support.ts'

export function logsRoutes(deps: CoreDeps) {
  return new Elysia()
    .get(
      '/api/v0/logs/timeline',
      async ({ headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'timeline:read',
          resource: 'timeline'
        })
        const entries = unwrapLogResult(await deps.log.listTimeline(), auth.correlationId)
        return { entries }
      },
      {
        response: protectedResponse(t.Object({ entries: t.Array(timelineLogSchema) }), {
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List timeline logs')
      }
    )
    .get(
      '/api/v0/logs/full',
      async ({ headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'log:read-full',
          resource: 'full-log'
        })
        const entries = unwrapLogResult(await deps.log.listFull(), auth.correlationId)
        return { entries }
      },
      {
        response: protectedResponse(t.Object({ entries: t.Array(fullLogSchema) }), {
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List full logs')
      }
    )
    .get(
      '/api/v0/audit',
      async ({ headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'audit:read',
          resource: 'audit'
        })
        const entries = unwrapLogResult(await deps.log.listAudit(), auth.correlationId)
        return { entries }
      },
      {
        response: protectedResponse(t.Object({ entries: t.Array(auditLogSchema) }), {
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List audit logs')
      }
    )
    .get(
      '/api/v0/logs/timeline/search',
      async ({ query, headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'timeline:read',
          resource: 'timeline'
        })
        return unwrapLogResult(
          await deps.log.searchTimeline(toTimelineSearchQuery(query)),
          auth.correlationId
        )
      },
      {
        query: t.Object({
          q: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
          subject: t.Optional(t.String()),
          correlationId: t.Optional(t.String())
        }),
        response: protectedResponse(
          t.Object({ entries: t.Array(timelineLogSchema), total: t.Number() }),
          { 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Search timeline logs')
      }
    )
    .get(
      '/api/v0/logs/full/search',
      async ({ query, headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'log:read-full',
          resource: 'full-log'
        })
        return unwrapLogResult(
          await deps.log.searchFull(toFullLogSearchQuery(query)),
          auth.correlationId
        )
      },
      {
        query: t.Object({
          q: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
          level: t.Optional(
            t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')])
          ),
          source: t.Optional(t.String()),
          correlationId: t.Optional(t.String()),
          traceId: t.Optional(t.String())
        }),
        response: protectedResponse(
          t.Object({ entries: t.Array(fullLogSchema), total: t.Number() }),
          { 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Search full logs')
      }
    )
    .get(
      '/api/v0/audit/search',
      async ({ query, headers, status: _status }) => {
        const auth = await requireLogAccess(deps, {
          headers,
          action: 'audit:read',
          resource: 'audit'
        })
        return unwrapLogResult(
          await deps.log.searchAudit(toAuditSearchQuery(query)),
          auth.correlationId
        )
      },
      {
        query: t.Object({
          q: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
          actor: t.Optional(t.String()),
          action: t.Optional(t.String()),
          resource: t.Optional(t.String()),
          decisionId: t.Optional(t.String()),
          correlationId: t.Optional(t.String())
        }),
        response: protectedResponse(
          t.Object({ entries: t.Array(auditLogSchema), total: t.Number() }),
          { 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Search audit logs')
      }
    )
}
