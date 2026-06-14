import { Elysia, t } from 'elysia'
import type {
  ActorId,
  BackfillParams,
  Permission,
  PolicyDecision,
  ProjectionCursor
} from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError } from '../middleware/route-support.ts'
import { apiErrorSchema, protectedResponse, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'

type ProjectionControlContext = {
  actor: ActorId
  correlationId: string
  permission: PolicyDecision
  action: Permission
  resource: string
}

async function writeProjectionControlAudit(
  deps: CoreDeps,
  context: ProjectionControlContext,
  payload: Record<string, unknown>
) {
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: context.action,
    resource: context.resource,
    decisionId: context.permission.id,
    result: context.permission.result,
    correlationId: context.correlationId,
    payload
  })
  if (!audit.ok)
    throw new CoreError(503, audit.error.code, audit.error.message, context.correlationId)
}

async function writeProjectionControlFailure(
  deps: CoreDeps,
  context: Pick<ProjectionControlContext, 'actor' | 'action' | 'resource' | 'correlationId'>,
  error: { code: string; message: string }
) {
  await deps.log.writeFull({
    level: 'warn',
    source: 'meristem-core',
    message: 'projection control failed',
    correlationId: context.correlationId,
    payload: {
      actor: context.actor,
      action: context.action,
      resource: context.resource,
      code: error.code,
      message: error.message
    }
  })
}

function optionalCursorPayload(cursor: ProjectionCursor | null) {
  return cursor ? { factId: cursor.factId, timestamp: cursor.timestamp } : null
}

/**
 * Projection routes separate read and control permissions while keeping Core as the REST adapter.
 * Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.3-2.5
 */
export function projectionRoutes(deps: CoreDeps) {
  return (
    new Elysia()
      // Projection read routes require only projection:read and do not create Audit Log facts.
      .get(
        '/api/v0/projection/health',
        async ({ headers, status: _status }) => {
          const auth = await requireActor(deps, headers)
          const _permission = await authorize(deps, {
            actor: auth.actor,
            action: 'projection:read',
            resource: 'projection',
            correlationId: auth.correlationId
          })
          const result = await deps.projection.getHealth()
          if (!result.ok) {
            await writeProjectionControlFailure(
              deps,
              {
                actor: auth.actor,
                action: 'projection:read',
                resource: 'projection',
                correlationId: auth.correlationId
              },
              result.error
            )
            throw new CoreError(503, result.error.code, result.error.message, auth.correlationId)
          }
          return { indices: result.value }
        },
        {
          response: protectedResponse(
            t.Object({
              indices: t.Array(
                t.Object({
                  index: t.String(),
                  lagSeconds: t.Number(),
                  lastProjectedAt: t.Union([t.String(), t.Null()]),
                  pendingCount: t.Number(),
                  dlqCount: t.Number(),
                  status: t.Union([
                    t.Literal('healthy'),
                    t.Literal('degraded'),
                    t.Literal('unavailable')
                  ])
                })
              )
            }),
            { 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Get projection health')
        }
      )
      // Projection control routes audit before calling M-Log and fail closed if audit is unavailable.
      .post(
        '/api/v0/projection/backfill',
        async ({ body, headers, status: _status }) => {
          const auth = await requireActor(deps, headers)
          const permission = await authorize(deps, {
            actor: auth.actor,
            action: 'projection:backfill',
            resource: `projection:${body.index}`,
            correlationId: auth.correlationId
          })
          const params: BackfillParams = {
            index: body.index,
            from: body.from ?? null,
            to: body.to ?? null,
            batchSize: Number(body.batchSize),
            ...(body.targetVersion ? { targetVersion: body.targetVersion } : {})
          }
          await writeProjectionControlAudit(
            deps,
            {
              actor: auth.actor,
              correlationId: auth.correlationId,
              permission,
              action: 'projection:backfill',
              resource: `projection:${body.index}`
            },
            {
              batchSize: params.batchSize,
              from: optionalCursorPayload(params.from),
              to: optionalCursorPayload(params.to),
              ...(params.targetVersion ? { targetVersion: params.targetVersion } : {})
            }
          )
          const result = await deps.projection.executeBackfill(params)
          if (!result.ok) {
            await writeProjectionControlFailure(
              deps,
              {
                actor: auth.actor,
                action: 'projection:backfill',
                resource: `projection:${body.index}`,
                correlationId: auth.correlationId
              },
              result.error
            )
            throw new CoreError(
              statusCodeForServiceError(result.error.code),
              result.error.code,
              result.error.message,
              auth.correlationId
            )
          }
          await deps.log.writeTimeline({
            summary: 'projection backfill completed',
            subject: body.index,
            correlationId: auth.correlationId
          })
          return result.value
        },
        {
          body: t.Object({
            index: t.String({ minLength: 1 }),
            from: t.Optional(t.Object({ factId: t.String(), timestamp: t.String() })),
            to: t.Optional(t.Object({ factId: t.String(), timestamp: t.String() })),
            batchSize: t.Numeric({ minimum: 1, maximum: 1000 }),
            targetVersion: t.Optional(t.String())
          }),
          response: protectedResponse(
            t.Object({
              jobId: t.String(),
              processedCount: t.Number(),
              errors: t.Number(),
              lastCursor: t.Union([
                t.Object({ factId: t.String(), timestamp: t.String() }),
                t.Null()
              ]),
              status: t.Union([
                t.Literal('pending'),
                t.Literal('running'),
                t.Literal('completed'),
                t.Literal('failed'),
                t.Literal('cancelled')
              ])
            }),
            { 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('Execute backfill')
        }
      )
      // Projection DLQ listing is read-only; replay and skip below are audited control operations.
      .get(
        '/api/v0/projection/dlq',
        async ({ query, headers, status: _status }) => {
          const auth = await requireActor(deps, headers)
          const _permission = await authorize(deps, {
            actor: auth.actor,
            action: 'projection:read',
            resource: 'projection-dlq',
            correlationId: auth.correlationId
          })
          const result = await deps.projection.listDLQ(query.index)
          if (!result.ok) {
            await writeProjectionControlFailure(
              deps,
              {
                actor: auth.actor,
                action: 'projection:read',
                resource: 'projection-dlq',
                correlationId: auth.correlationId
              },
              result.error
            )
            throw new CoreError(503, result.error.code, result.error.message, auth.correlationId)
          }
          return { records: result.value }
        },
        {
          query: t.Object({ index: t.Optional(t.String()) }),
          response: protectedResponse(
            t.Object({
              records: t.Array(
                t.Object({
                  id: t.String(),
                  jobId: t.String(),
                  factId: t.String(),
                  index: t.String(),
                  error: t.String(),
                  attemptedAt: t.Array(t.String()),
                  retries: t.Number(),
                  createdAt: t.String()
                })
              )
            }),
            { 503: apiErrorSchema }
          ),
          detail: protectedRouteDetail('List DLQ records')
        }
      )

      // Replay writes Audit first, then delegates the DLQ record mutation to M-Log.
      .post(
        '/api/v0/projection/dlq/:id/replay',
        async ({ params, headers, status: _status }) => {
          const auth = await requireActor(deps, headers)
          const permission = await authorize(deps, {
            actor: auth.actor,
            action: 'projection:dlq-manage',
            resource: `projection-dlq:${params.id}`,
            correlationId: auth.correlationId
          })
          await writeProjectionControlAudit(
            deps,
            {
              actor: auth.actor,
              correlationId: auth.correlationId,
              permission,
              action: 'projection:dlq-manage',
              resource: `projection-dlq:${params.id}`
            },
            { operation: 'replay' }
          )
          const result = await deps.projection.replayDLQ(params.id)
          if (!result.ok) {
            await writeProjectionControlFailure(
              deps,
              {
                actor: auth.actor,
                action: 'projection:dlq-manage',
                resource: `projection-dlq:${params.id}`,
                correlationId: auth.correlationId
              },
              result.error
            )
            throw new CoreError(
              statusCodeForServiceError(result.error.code),
              result.error.code,
              result.error.message,
              auth.correlationId
            )
          }
          await deps.log.writeTimeline({
            summary: 'projection DLQ replay completed',
            subject: params.id,
            correlationId: auth.correlationId
          })
          return { replayed: result.value }
        },
        {
          response: protectedResponse(t.Object({ replayed: t.Boolean() }), { 503: apiErrorSchema }),
          detail: protectedRouteDetail('Replay DLQ record')
        }
      )
      // Skip writes Audit first, then delegates the DLQ record mutation to M-Log.
      .post(
        '/api/v0/projection/dlq/:id/skip',
        async ({ params, headers, status: _status }) => {
          const auth = await requireActor(deps, headers)
          const permission = await authorize(deps, {
            actor: auth.actor,
            action: 'projection:dlq-manage',
            resource: `projection-dlq:${params.id}`,
            correlationId: auth.correlationId
          })
          await writeProjectionControlAudit(
            deps,
            {
              actor: auth.actor,
              correlationId: auth.correlationId,
              permission,
              action: 'projection:dlq-manage',
              resource: `projection-dlq:${params.id}`
            },
            { operation: 'skip' }
          )
          const result = await deps.projection.skipDLQ(params.id)
          if (!result.ok) {
            await writeProjectionControlFailure(
              deps,
              {
                actor: auth.actor,
                action: 'projection:dlq-manage',
                resource: `projection-dlq:${params.id}`,
                correlationId: auth.correlationId
              },
              result.error
            )
            throw new CoreError(
              statusCodeForServiceError(result.error.code),
              result.error.code,
              result.error.message,
              auth.correlationId
            )
          }
          await deps.log.writeTimeline({
            summary: 'projection DLQ skip completed',
            subject: params.id,
            correlationId: auth.correlationId
          })
          return { skipped: result.value }
        },
        {
          response: protectedResponse(t.Object({ skipped: t.Boolean() }), { 503: apiErrorSchema }),
          detail: protectedRouteDetail('Skip DLQ record')
        }
      )
  )
}

export type ProjectionRoutes = ReturnType<typeof projectionRoutes>
