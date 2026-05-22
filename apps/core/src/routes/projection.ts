import { Elysia, t } from "elysia"
import type { CoreDeps } from "../types.ts"
import { requireActor, authorize } from "../middleware/auth.ts"
import { apiError } from "../errors.ts"
import { apiErrorSchema, protectedRouteDetail, protectedResponse } from "../schemas.ts"

/**
 * Phase 10.1 Projection routes: backfill, projection health, DLQ management.
 * All routes require admin or security-admin role.
 * Source: docs/roadmap/PHASE-10.1.md 2.5, 2.6, 2.4
 */
export function projectionRoutes(deps: CoreDeps) {
  return new Elysia()
    // 2.6 Projection health
    .get("/api/v0/projection/health", async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: "core:read", resource: "projection", correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.projection.getHealth()
      return result.ok ? { indices: result.value } : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
      response: protectedResponse(
        t.Object({
          indices: t.Array(t.Object({
            index: t.String(),
            lagSeconds: t.Number(),
            lastProjectedAt: t.Union([t.String(), t.Null()]),
            pendingCount: t.Number(),
            dlqCount: t.Number(),
            status: t.Union([t.Literal("healthy"), t.Literal("degraded"), t.Literal("unavailable")])
          }))
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail("Get projection health")
    })
    // 2.5 Backfill
    .post("/api/v0/projection/backfill", async ({ body, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: "core:read", resource: "projection", correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.projection.executeBackfill({
        index: body.index,
        from: body.from ?? null,
        to: body.to ?? null,
        batchSize: Number(body.batchSize),
        ...(body.targetVersion ? { targetVersion: body.targetVersion } : {})
      })
      return result.ok ? result.value : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
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
          lastCursor: t.Union([t.Object({ factId: t.String(), timestamp: t.String() }), t.Null()]),
          status: t.Union([t.Literal("pending"), t.Literal("running"), t.Literal("completed"), t.Literal("failed"), t.Literal("cancelled")])
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail("Execute backfill")
    })
    // 2.4 DLQ list
    .get("/api/v0/projection/dlg", async ({ query, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(deps, { actor: auth.actor, action: "core:read", resource: "projection", correlationId: auth.correlationId }, status)
      if (!permission.ok) return permission.response
      const result = await deps.projection.listDLQ(query.index)
      return result.ok ? { records: result.value } : apiError(status, 503, result.error.code, result.error.message, auth.correlationId)
    }, {
      query: t.Object({ index: t.Optional(t.String()) }),
      response: protectedResponse(
        t.Object({
          records: t.Array(t.Object({
            id: t.String(), jobId: t.String(), factId: t.String(), index: t.String(),
            error: t.String(), attemptedAt: t.Array(t.String()), retries: t.Number(), createdAt: t.String()
          }))
        }),
        { 503: apiErrorSchema }
      ),
      detail: protectedRouteDetail("List DLQ records")
    })
}

export type ProjectionRoutes = ReturnType<typeof projectionRoutes>
