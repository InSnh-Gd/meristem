import { Elysia, t } from 'elysia'
import { apiErrorSchema, protectedResponse, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import {
  optionalCursorPayload,
  runProjectionControl,
  runProjectionRead,
  toBackfillParams,
} from './projection-support.ts'

/**
 * Projection routes separate read and control permissions while keeping Core as the REST adapter.
 * 来源：`docs/contracts/REST-API-MVP.md`、`docs/services/m-log.md` 和投影契约 schema。
 */
export function projectionRoutes(deps: CoreDeps) {
  return new Elysia()
    .get(
      '/api/v0/projection/health',
      async ({ headers, status: _status }) => ({
        indices: await runProjectionRead(deps, {
          headers,
          resource: 'projection',
          run: () => deps.projection.getHealth()
        })
      }),
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
    .post(
      '/api/v0/projection/backfill',
      async ({ body, headers, status: _status }) => {
        const params = toBackfillParams(body)
        return runProjectionControl(deps, {
          headers,
          action: 'projection:backfill',
          resource: `projection:${body.index}`,
          auditPayload: {
            batchSize: params.batchSize,
            from: optionalCursorPayload(params.from),
            to: optionalCursorPayload(params.to),
            ...(params.targetVersion ? { targetVersion: params.targetVersion } : {})
          },
          timeline: {
            summary: 'projection backfill completed',
            subject: body.index
          },
          run: () => deps.projection.executeBackfill(params)
        })
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
    .get(
      '/api/v0/projection/dlq',
      async ({ query, headers, status: _status }) => ({
        records: await runProjectionRead(deps, {
          headers,
          resource: 'projection-dlq',
          run: () => deps.projection.listDLQ(query.index)
        })
      }),
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
    .post(
      '/api/v0/projection/dlq/:id/replay',
      async ({ params, headers, status: _status }) => ({
        replayed: await runProjectionControl(deps, {
          headers,
          action: 'projection:dlq-manage',
          resource: `projection-dlq:${params.id}`,
          auditPayload: { operation: 'replay' },
          timeline: { summary: 'projection DLQ replay completed', subject: params.id },
          run: () => deps.projection.replayDLQ(params.id)
        })
      }),
      {
        response: protectedResponse(t.Object({ replayed: t.Boolean() }), { 503: apiErrorSchema }),
        detail: protectedRouteDetail('Replay DLQ record')
      }
    )
    .post(
      '/api/v0/projection/dlq/:id/skip',
      async ({ params, headers, status: _status }) => ({
        skipped: await runProjectionControl(deps, {
          headers,
          action: 'projection:dlq-manage',
          resource: `projection-dlq:${params.id}`,
          auditPayload: { operation: 'skip' },
          timeline: { summary: 'projection DLQ skip completed', subject: params.id },
          run: () => deps.projection.skipDLQ(params.id)
        })
      }),
      {
        response: protectedResponse(t.Object({ skipped: t.Boolean() }), { 503: apiErrorSchema }),
        detail: protectedRouteDetail('Skip DLQ record')
      }
    )
}

export type ProjectionRoutes = ReturnType<typeof projectionRoutes>
