import { Elysia } from 'elysia'
import { reconcileMDeployAgent } from './agent-workflow.ts'
import type { MDeployDeps, MDeployError } from './deps.ts'
import {
  enrollMDeployAgent,
  isMDeployRouteFailure,
  recordMDeployDrift,
  recordMDeployHeartbeat,
  requireMDeployInternalRequest
} from './internal-support.ts'
import {
  agentEnrollmentBodySchema,
  agentHeartbeatBodySchema,
  driftReportBodySchema,
  identifierParamsSchema
} from './route-schemas.ts'

function errorResponse(error: MDeployError, correlationId?: string): Response {
  const status = error.code.includes('not_found')
    ? 404
    : error.code.includes('mismatch') ||
        error.code === 'unsigned_desired_state' ||
        error.code === 'stale_desired_state' ||
        error.code === 'signature_verification_failed' ||
        error.code === 'runtime_driver_mismatch'
      ? 409
      : 503
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(correlationId ? { correlationId } : {})
      }
    },
    { status }
  )
}

/** loopback agent API：所有运行时行为都从此处由 agent 主动拉取，不存在 SSH push。 */
export function createMDeployInternalRoutes(deps: MDeployDeps) {
  return new Elysia()
    .post(
      '/internal/v0/deploy/agents/enroll',
      async ({ body, headers }) => {
        const request = requireMDeployInternalRequest(headers)
        if (isMDeployRouteFailure(request))
          return Response.json(request.body, { status: request.status })
        const enrollment = await enrollMDeployAgent(deps, body)
        return enrollment.ok
          ? { agent: enrollment.value }
          : errorResponse(enrollment.error, request.correlationId)
      },
      { body: agentEnrollmentBodySchema }
    )
    .post(
      '/internal/v0/deploy/agents/:id/heartbeat',
      async ({ params, body, headers }) => {
        const request = requireMDeployInternalRequest(headers)
        if (isMDeployRouteFailure(request))
          return Response.json(request.body, { status: request.status })
        const heartbeat = await recordMDeployHeartbeat(deps, params.id, body)
        return heartbeat.ok
          ? { agent: heartbeat.value }
          : errorResponse(heartbeat.error, request.correlationId)
      },
      { params: identifierParamsSchema, body: agentHeartbeatBodySchema }
    )
    .post(
      '/internal/v0/deploy/agents/:id/reconcile',
      async ({ params, headers }) => {
        const request = requireMDeployInternalRequest(headers)
        if (isMDeployRouteFailure(request))
          return Response.json(request.body, { status: request.status })
        const reconcile = await reconcileMDeployAgent(deps, params.id)
        if (!reconcile.ok) return errorResponse(reconcile.error, request.correlationId)
        return reconcile.value.schemaVersion === 'mdeploy.rollback-result@0.1.0'
          ? { rollback: reconcile.value }
          : { reconcile: reconcile.value }
      },
      { params: identifierParamsSchema }
    )
    .post(
      '/internal/v0/deploy/drift',
      async ({ body, headers }) => {
        const request = requireMDeployInternalRequest(headers)
        if (isMDeployRouteFailure(request))
          return Response.json(request.body, { status: request.status })
        const drift = await recordMDeployDrift(deps, body, request.correlationId)
        return drift.ok
          ? { report: drift.value }
          : errorResponse(drift.error, request.correlationId)
      },
      { body: driftReportBodySchema }
    )
}
