import { Elysia } from 'elysia'
import { deploymentPermission } from '../../../packages/contracts/src/index.ts'
import {
  createMDeployProposal,
  isMDeployRouteFailure,
  recordMDeployApproval,
  requireDeploymentAuthorization,
  requireMDeployPublicContext,
  routeFailure,
  scheduleMDeployOperation,
  scheduleMDeployRollback
} from './controller-support.ts'
import type { MDeployDeps, MDeployError } from './deps.ts'
import {
  applyBodySchema,
  approvalBodySchema,
  identifierParamsSchema,
  proposalBodySchema,
  rollbackBodySchema
} from './route-schemas.ts'

function failureResponse(failure: { status: number; body: unknown }): Response {
  return Response.json(failure.body, { status: failure.status })
}

function errorResponse(error: MDeployError, correlationId: string): Response {
  const status = error.code.startsWith('policy.')
    ? 403
    : error.code.includes('not_found')
      ? 404
      : error.code.includes('not_approved') || error.code.includes('mismatch')
        ? 409
        : error.code.includes('unavailable')
          ? 503
          : 400
  return failureResponse(failureForStatus(status, error, correlationId))
}

function failureForStatus(status: number, error: MDeployError, correlationId: string) {
  if (status === 403) return routeFailure(403, error, correlationId)
  if (status === 404) return routeFailure(404, error, correlationId)
  if (status === 409) return routeFailure(409, error, correlationId)
  if (status === 503) return routeFailure(503, error, correlationId)
  return routeFailure(400, error, correlationId)
}

/** Core-facing public contract：路由只做 TypeBox 校验、上下文提取和 workflow 结果映射。 */
export function createMDeployPublicRoutes(deps: MDeployDeps) {
  return new Elysia()
    .get('/api/v0/deploy/desired-state', async ({ headers }) => {
      const context = await requireMDeployPublicContext(deps, headers)
      if (isMDeployRouteFailure(context)) return failureResponse(context)
      const authorized = await requireDeploymentAuthorization(
        deps,
        context,
        deploymentPermission.desiredStateRead,
        'deploy:desired-state'
      )
      if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
      const summary = await deps.store.desiredStateSummary(await deps.controller.isAvailable())
      return summary.ok ? summary.value : errorResponse(summary.error, context.correlationId)
    })
    .post(
      '/api/v0/deploy/proposals',
      async ({ body, headers }) => {
        const context = await requireMDeployPublicContext(deps, headers)
        if (isMDeployRouteFailure(context)) return failureResponse(context)
        const proposal = await createMDeployProposal(deps, context, body)
        return proposal.ok
          ? { proposal: proposal.value }
          : errorResponse(proposal.error, context.correlationId)
      },
      { body: proposalBodySchema }
    )
    .get(
      '/api/v0/deploy/proposals/:id',
      async ({ params, headers }) => {
        const context = await requireMDeployPublicContext(deps, headers)
        if (isMDeployRouteFailure(context)) return failureResponse(context)
        const authorized = await requireDeploymentAuthorization(
          deps,
          context,
          deploymentPermission.desiredStateRead,
          `deploy-proposal:${params.id}`
        )
        if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
        const proposal = await deps.store.getProposal(params.id)
        if (!proposal.ok) return errorResponse(proposal.error, context.correlationId)
        return proposal.value
          ? { proposal: proposal.value }
          : failureResponse(
              routeFailure(
                404,
                { code: 'deploy.proposal_not_found', message: 'proposal not found' },
                context.correlationId
              )
            )
      },
      { params: identifierParamsSchema }
    )
    .post(
      '/api/v0/deploy/proposals/:id/approve',
      async ({ params, body, headers }) => {
        const context = await requireMDeployPublicContext(deps, headers)
        if (isMDeployRouteFailure(context)) return failureResponse(context)
        const approval = await recordMDeployApproval(deps, context, params.id, body.result)
        return approval.ok
          ? { approval: approval.value }
          : errorResponse(approval.error, context.correlationId)
      },
      { params: identifierParamsSchema, body: approvalBodySchema }
    )
    .post(
      '/api/v0/deploy/apply',
      async ({ body, headers }) => {
        const context = await requireMDeployPublicContext(deps, headers)
        if (isMDeployRouteFailure(context)) return failureResponse(context)
        const operation = await scheduleMDeployOperation(deps, context, { ...body, kind: 'apply' })
        return operation.ok
          ? { operation: { ...operation.value, applyStatus: operation.value.status } }
          : errorResponse(operation.error, context.correlationId)
      },
      { body: applyBodySchema }
    )
    .post(
      '/api/v0/deploy/rollback',
      async ({ body, headers }) => {
        const context = await requireMDeployPublicContext(deps, headers)
        if (isMDeployRouteFailure(context)) return failureResponse(context)
        const operation = await scheduleMDeployRollback(deps, context, body)
        return operation.ok
          ? { operation: operation.value }
          : errorResponse(operation.error, context.correlationId)
      },
      { body: rollbackBodySchema }
    )
    .get('/api/v0/deploy/drift', async ({ headers }) => {
      const context = await requireMDeployPublicContext(deps, headers)
      if (isMDeployRouteFailure(context)) return failureResponse(context)
      const authorized = await requireDeploymentAuthorization(
        deps,
        context,
        deploymentPermission.driftRead,
        'deploy:drift'
      )
      if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
      const drift = await deps.store.listDrift()
      return drift.ok ? { reports: drift.value } : errorResponse(drift.error, context.correlationId)
    })
    .post('/api/v0/deploy/drift/check', async ({ headers }) => {
      const context = await requireMDeployPublicContext(deps, headers)
      if (isMDeployRouteFailure(context)) return failureResponse(context)
      const authorized = await requireDeploymentAuthorization(
        deps,
        context,
        deploymentPermission.driftRead,
        'deploy:drift'
      )
      if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
      return { requested: true, correlationId: context.correlationId }
    })
    .get('/api/v0/deploy/evidence', async ({ headers }) => {
      const context = await requireMDeployPublicContext(deps, headers)
      if (isMDeployRouteFailure(context)) return failureResponse(context)
      const authorized = await requireDeploymentAuthorization(
        deps,
        context,
        deploymentPermission.evidenceRead,
        'deploy:evidence'
      )
      if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
      const evidence = await deps.store.listEvidence()
      return evidence.ok
        ? { evidence: evidence.value }
        : errorResponse(evidence.error, context.correlationId)
    })
    .get('/api/v0/deploy/agents', async ({ headers }) => {
      const context = await requireMDeployPublicContext(deps, headers)
      if (isMDeployRouteFailure(context)) return failureResponse(context)
      const authorized = await requireDeploymentAuthorization(
        deps,
        context,
        deploymentPermission.desiredStateRead,
        'deploy:agents'
      )
      if (isMDeployRouteFailure(authorized)) return failureResponse(authorized)
      const agents = await deps.store.listAgents()
      return agents.ok
        ? { agents: agents.value }
        : errorResponse(agents.error, context.correlationId)
    })
}
