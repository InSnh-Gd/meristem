import { Elysia, t } from 'elysia'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import {
  apiErrorSchema,
  protectedResponse,
  protectedRouteDetail,
  serviceSummarySchema
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  publishServiceRegistered,
  publishServiceReloadRequested,
  requireServiceMutationAccess,
  requireServiceReadAccess,
  unwrapServiceResult,
  writeServiceAuditOrThrow,
  writeServiceReloadFailure,
  writeServiceTimeline
} from './services-support.ts'

export function servicesRoutes(deps: CoreDeps) {
  return new Elysia()
    .post(
      '/api/v0/services',
      async ({ body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.service.register', headers, async () => {
          const auth = await requireServiceMutationAccess(deps, {
            headers,
            action: 'service:register',
            resource: 'service-definition'
          })

          await writeServiceAuditOrThrow(deps, {
            actor: auth.actor,
            action: 'service:register',
            resource: 'service-definition',
            permission: auth.permission,
            correlationId: auth.correlationId
          })

          const service = await deps.storage.registerService(body)
          await publishServiceRegistered(deps, service, auth.correlationId)

          return {
            service,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
        response: protectedResponse(
          t.Object({
            service: t.Unknown(),
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          { 503: apiErrorSchema }
        ),
        detail: protectedRouteDetail('Register a service definition')
      }
    )
    .get(
      '/api/v0/services',
      async ({ headers, status: _status }) => {
        const auth = await requireServiceReadAccess(deps, headers, 'services')
        const services = unwrapServiceResult(await deps.services.list(), auth.correlationId)
        return { services }
      },
      {
        response: protectedResponse(t.Object({ services: t.Array(serviceSummarySchema) }), {
          503: apiErrorSchema
        }),
        detail: protectedRouteDetail('List service runtime summaries')
      }
    )
    .post(
      '/api/v0/services/:id/reload',
      async ({ params, body, headers, status: _status }) => {
        return withExtractedSpan('meristem-core', 'core.service.reload', headers, async () => {
          const auth = await requireServiceMutationAccess(deps, {
            headers,
            action: 'service:reload',
            resource: `service:${params.id}`
          })

          await writeServiceAuditOrThrow(deps, {
            actor: auth.actor,
            action: 'service:reload',
            resource: `service:${params.id}`,
            permission: auth.permission,
            correlationId: auth.correlationId,
            ...(body.reason ? { payload: { reason: body.reason } } : {})
          })

          await publishServiceReloadRequested(deps, {
            serviceId: params.id,
            correlationId: auth.correlationId,
            ...(body.reason ? { reason: body.reason } : {})
          })

          await writeServiceTimeline(deps, {
            summary: `requested reload for service ${params.id}`,
            subject: params.id,
            correlationId: auth.correlationId
          })

          const reloadedResult = await deps.services.reload({
            serviceId: params.id,
            correlationId: auth.correlationId,
            ...(body.reason ? { reason: body.reason } : {})
          })

          if (!reloadedResult.ok) {
            await writeServiceReloadFailure(deps, auth.correlationId, reloadedResult.error)
          }
          const reloaded = unwrapServiceResult(reloadedResult, auth.correlationId)

          await writeServiceTimeline(deps, {
            summary: `reloaded service ${params.id}`,
            subject: params.id,
            correlationId: auth.correlationId
          })

          return {
            serviceId: reloaded.serviceId,
            accepted: true as const,
            reloadedAt: reloaded.reloadedAt,
            policyDecisionId: auth.permission.id,
            correlationId: auth.correlationId
          }
        })
      },
      {
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
      }
    )
}
