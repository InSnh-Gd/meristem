import { Elysia } from 'elysia'
import { Value } from '@sinclair/typebox/value'
import { apiErrorRouteSchema } from '../../../packages/contracts/src/elysia.ts'
import type { MNetAppDeps } from './deps.ts'
import { externalApiError } from './route-helpers.ts'
import {
  closedLoopIdParamsSchema,
  closedLoopNetworkParamsSchema,
  breakGlassResponseSchema,
  credentialLifecycleResponseSchema,
  decideJoinBodySchema,
  initiateBreakGlassBodySchema,
  joinDecisionResponseSchema,
  migrateProfileBodySchema,
  migrationResponseSchema,
  reasonBodySchema,
  relayPolicyBodySchema,
  relayPolicyResponseSchema,
  rotateCredentialBodySchema,
  submitJoinBodySchema,
  submitJoinResponseSchema,
  topologyResponseSchema
} from './closed-loop-route-schemas.ts'
import { requireClosedLoopRouteContext } from './closed-loop-route-support.ts'
import type { ClosedLoopFailure } from './closed-loop-workflow.ts'

const errorResponses = {
  400: apiErrorRouteSchema,
  401: apiErrorRouteSchema,
  403: apiErrorRouteSchema,
  404: apiErrorRouteSchema,
  409: apiErrorRouteSchema,
  503: apiErrorRouteSchema
}

function mapFailure(
  set: { status?: number | string },
  result: {
    kind: 'failure'
    status: 400 | 401 | 403 | 404 | 409 | 503
    error: { code: string; message: string }
  }
) {
  return externalApiError(set, result.status, result.error.code, result.error.message)
}

function isFailure(result: unknown): result is ClosedLoopFailure {
  return typeof result === 'object' && result !== null && Reflect.get(result, 'kind') === 'failure'
}

/**
 * TypeBox 负责输入，auth helper 负责身份，workflow 独占 policy/Audit/事件编排。
 */
export function createClosedLoopRoutes(deps: Pick<MNetAppDeps, 'auth' | 'closedLoop'>) {
  return new Elysia({ prefix: '/api/v0/mnet/closed-loop' })
    .post(
      '/join-requests',
      async ({ body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.submitJoinRequest({
          ...body,
          requestedBy: context.actor,
          correlationId: context.correlationId
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(submitJoinResponseSchema, result)
      },
      { body: submitJoinBodySchema, response: { 200: submitJoinResponseSchema, ...errorResponses } }
    )
    .post(
      '/join-requests/:id/decision',
      async ({ params, body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.decideJoinRequest(
          body.decision === 'approve'
            ? {
                actor: context.actor,
                requestId: params.id,
                decision: 'approve',
                credentialExpiresAt: body.credentialExpiresAt
              }
            : {
                actor: context.actor,
                requestId: params.id,
                decision: 'reject',
                reason: body.reason
              }
        )
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(joinDecisionResponseSchema, result)
      },
      {
        params: closedLoopIdParamsSchema,
        body: decideJoinBodySchema,
        response: { 200: joinDecisionResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/credentials/:id/rotate',
      async ({ params, body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.rotateCredential({
          actor: context.actor,
          credentialId: params.id,
          expiresAt: body.expiresAt,
          reason: body.reason
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(credentialLifecycleResponseSchema, result)
      },
      {
        params: closedLoopIdParamsSchema,
        body: rotateCredentialBodySchema,
        response: { 200: credentialLifecycleResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/credentials/:id/revoke',
      async ({ params, body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.revokeCredential({
          actor: context.actor,
          credentialId: params.id,
          reason: body.reason
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(credentialLifecycleResponseSchema, result)
      },
      {
        params: closedLoopIdParamsSchema,
        body: reasonBodySchema,
        response: { 200: credentialLifecycleResponseSchema, ...errorResponses }
      }
    )
    .get(
      '/networks/:networkId/topology',
      async ({ params, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.getTopologyView({
          actor: context.actor,
          networkId: params.networkId,
          correlationId: context.correlationId
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(topologyResponseSchema, result)
      },
      {
        params: closedLoopNetworkParamsSchema,
        response: { 200: topologyResponseSchema, ...errorResponses }
      }
    )
    .put(
      '/networks/:networkId/relay-policy',
      async ({ params, body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.changeRelayPolicy({
          actor: context.actor,
          networkId: params.networkId,
          ...body
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(relayPolicyResponseSchema, result)
      },
      {
        params: closedLoopNetworkParamsSchema,
        body: relayPolicyBodySchema,
        response: { 200: relayPolicyResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/migrations',
      async ({ body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.migrateProfile({ actor: context.actor, ...body })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(migrationResponseSchema, result)
      },
      {
        body: migrateProfileBodySchema,
        response: { 200: migrationResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/migrations/:id/rollback',
      async ({ params, body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.rollbackProfile({
          actor: context.actor,
          migrationId: params.id,
          reason: body.reason
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(migrationResponseSchema, result)
      },
      {
        params: closedLoopIdParamsSchema,
        body: reasonBodySchema,
        response: { 200: migrationResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/break-glass',
      async ({ body, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.initiateBreakGlass({ actor: context.actor, ...body })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(breakGlassResponseSchema, result)
      },
      {
        body: initiateBreakGlassBodySchema,
        response: { 200: breakGlassResponseSchema, ...errorResponses }
      }
    )
    .post(
      '/break-glass/:id/approve',
      async ({ params, headers, set }) => {
        const context = await requireClosedLoopRouteContext(deps, headers)
        if ('kind' in context) return mapFailure(set, context)
        const result = await context.service.approveBreakGlass({
          actor: context.actor,
          grantId: params.id
        })
        return isFailure(result)
          ? mapFailure(set, result)
          : Value.Parse(breakGlassResponseSchema, result)
      },
      {
        params: closedLoopIdParamsSchema,
        response: { 200: breakGlassResponseSchema, ...errorResponses }
      }
    )
}
