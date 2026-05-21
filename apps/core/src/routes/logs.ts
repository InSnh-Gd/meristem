import { Elysia, t } from 'elysia'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { apiError } from '../errors.ts'
import { apiErrorSchema, timelineLogSchema, fullLogSchema, auditLogSchema, protectedRouteDetail, protectedResponse } from '../schemas.ts'

export function logsRoutes(deps: CoreDeps) {
  return new Elysia()
    .get('/api/v0/logs/timeline', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'timeline:read', resource: 'timeline', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const entries = await deps.log.listTimeline()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(t.Object({ entries: t.Array(timelineLogSchema) }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('List timeline logs')
    })
    .get('/api/v0/logs/full', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'log:read-full', resource: 'full-log', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const entries = await deps.log.listFull()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(t.Object({ entries: t.Array(fullLogSchema) }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('List full logs')
    })
    .get('/api/v0/audit', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'audit:read', resource: 'audit', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const entries = await deps.log.listAudit()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    }, {
      response: protectedResponse(t.Object({ entries: t.Array(auditLogSchema) }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('List audit logs')
    })
    .get('/api/v0/logs/timeline/search', async ({ query, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'timeline:read', resource: 'timeline', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.log.searchTimeline({
        ...(query.q ? { q: query.q } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {})
      })
      return result.ok ? result.value : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
      query: t.Object({
        q: t.Optional(t.String()), from: t.Optional(t.String()), to: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), subject: t.Optional(t.String()), correlationId: t.Optional(t.String())
      }),
      response: protectedResponse(t.Object({ entries: t.Array(timelineLogSchema), total: t.Number() }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('Search timeline logs')
    })
    .get('/api/v0/logs/full/search', async ({ query, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'log:read-full', resource: 'full-log', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.log.searchFull({
        ...(query.q ? { q: query.q } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
        ...(query.level ? { level: query.level as 'debug' | 'info' | 'warn' | 'error' } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        ...(query.traceId ? { traceId: query.traceId } : {})
      })
      return result.ok ? result.value : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
      query: t.Object({
        q: t.Optional(t.String()), from: t.Optional(t.String()), to: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), level: t.Optional(t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')])),
        source: t.Optional(t.String()), correlationId: t.Optional(t.String()), traceId: t.Optional(t.String())
      }),
      response: protectedResponse(t.Object({ entries: t.Array(fullLogSchema), total: t.Number() }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('Search full logs')
    })
    .get('/api/v0/audit/search', async ({ query, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: 'audit:read', resource: 'audit', correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.log.searchAudit({
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
      return result.ok ? result.value : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
      query: t.Object({
        q: t.Optional(t.String()), from: t.Optional(t.String()), to: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), actor: t.Optional(t.String()), action: t.Optional(t.String()),
        resource: t.Optional(t.String()), decisionId: t.Optional(t.String()), correlationId: t.Optional(t.String())
      }),
      response: protectedResponse(t.Object({ entries: t.Array(auditLogSchema), total: t.Number() }), { 503: apiErrorSchema }),
      detail: protectedRouteDetail('Search audit logs')
    })
}
