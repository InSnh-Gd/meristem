import { Elysia, t } from 'elysia'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent, joinSessionUrl } from '../middleware/helpers.ts'
import { apiError } from '../errors.ts'
import {
  apiErrorSchema,
  dependenciesSchema,
  nodeSchema,
  taskSchema,
  networkSchema,
  networkSummarySchema,
  networkMemberSchema,
  policyDecisionSchema,
  timelineLogSchema,
  fullLogSchema,
  auditLogSchema,
  serviceSummarySchema,
  protectedRouteDetail,
  protectedResponse
} from '../schemas.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'


export function servicesRoutes(deps: CoreDeps) {
  return new Elysia()
    .post('/api/v0/services', async ({ body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.service.register', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'service:register', resource: 'service-definition', correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'service:register',
          resource: 'service-definition',
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const service = await deps.storage.registerService(body)
        await deps.events.publish(
          'service.lifecycle.registered.v0',
          tracedEvent({
            type: 'service.lifecycle.registered',
            source: 'meristem-core',
            payload: service,
            correlationId: auth.correlationId
          })
        )
        return { service, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      })
    }, {
      response: protectedResponse(
        t.Object({
          service: t.Unknown(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Register a service definition')
    })
    .get('/api/v0/services', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'services', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const svcs = await deps.services.list()
      if (!svcs.ok) {
        return apiError(status, 503, svcs.error.code, svcs.error.message, auth.correlationId)
      }
      return { services: svcs.value }
    }, {
      response: protectedResponse(
        t.Object({ services: t.Array(serviceSummarySchema) }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('List service runtime summaries')
    })
    .post('/api/v0/services/:id/reload', async ({ params, body, headers, status }) => {
      return withExtractedSpan('meristem-core', 'core.service.reload', headers, async () => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'service:reload', resource: `service:${params.id}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'service:reload',
          resource: `service:${params.id}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId,
          payload: body.reason ? { reason: body.reason } : undefined
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        await deps.events.publish(
          'service.lifecycle.reload.requested.v0',
          tracedEvent({
            type: 'service.lifecycle.reload.requested',
            source: 'meristem-core',
            payload: { serviceId: params.id, ...(body.reason ? { reason: body.reason } : {}) },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `requested reload for service ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })

        const reloaded = await deps.services.reload({
          serviceId: params.id,
          correlationId: auth.correlationId,
          ...(body.reason ? { reason: body.reason } : {})
        })
        if (!reloaded.ok) {
          await deps.events.publish(
            'service.lifecycle.reload.failed.v0',
            tracedEvent({
              type: 'service.lifecycle.reload.failed',
              source: 'meristem-core',
              payload: { serviceId: params.id, code: reloaded.error.code, message: reloaded.error.message },
              correlationId: auth.correlationId
            })
          )
          await deps.log.writeFull({
            level: 'error',
            source: 'meristem-core',
            message: `service reload failed for ${params.id}`,
            correlationId: auth.correlationId,
            payload: { code: reloaded.error.code, message: reloaded.error.message }
          })
          return apiError(
            status,
            statusCodeForServiceError(reloaded.error.code),
            reloaded.error.code,
            reloaded.error.message,
            auth.correlationId
          )
        }

        await deps.log.writeTimeline({
          summary: `reloaded service ${params.id}`,
          subject: params.id,
          correlationId: auth.correlationId
        })

        return {
          serviceId: reloaded.value.serviceId,
          accepted: true as const,
          reloadedAt: reloaded.value.reloadedAt,
          policyDecisionId: permission.decision.id,
          correlationId: auth.correlationId
        }
      })
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({ reason: t.Optional(t.String()) }),
      response: protectedResponse(
        t.Object({
          serviceId: t.String(),
          accepted: t.Literal(true),
          reloadedAt: t.String(),
          policyDecisionId: t.String(),
          correlationId: t.String()
        }),
        { 404: apiErrorSchema, 409: apiErrorSchema, 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail('Reload a reloadable service')
    })
}
