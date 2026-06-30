import { Elysia, t } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { executeForcedRelayChange, deriveForcedRelayEligibility } from './forced-relay-workflow.ts'
import {
  externalMigrationRequiredRouteBody,
  isMigrationRequiredFailure
} from './migration-required-support.ts'
import { externalApiError, verifyBearerAuth } from './route-helpers.ts'

const forcedRelayBodySchema = t.Object({
  nodeId: t.String({ minLength: 1 }),
  reason: t.Optional(t.String())
})

const forcedRelayEligibilitySchema = t.Union([
  t.Object({
    state: t.Literal('enabled'),
    command: t.Object({
      id: t.String(),
      label: t.String(),
      action: t.String(),
      resource: t.String(),
      risk: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('critical')]),
      requiredPermissions: t.Array(t.String()),
      requiresPolicy: t.Boolean(),
      requiresAudit: t.Boolean()
    })
  }),
  t.Object({
    state: t.Literal('disabled'),
    disabled: t.Object({
      code: t.String(),
      message: t.String(),
      missingPermission: t.Optional(t.String()),
      migration: t.Optional(t.Any())
    }),
    disabledReason: t.String()
  })
])

const forcedRelayResultSchema = t.Object({
  status: t.Literal('applied'),
  networkId: t.String(),
  nodeId: t.String(),
  profileVersion: t.Literal('m-net-cn@0.3.0'),
  routeClass: t.Literal('forced-tcp-relay'),
  selectorOwnership: t.Literal('operator'),
  affectedNodeIds: t.Array(t.String()),
  policyDecisionId: t.String(),
  auditId: t.String(),
  eventId: t.String(),
  correlationId: t.String(),
  publishStatus: t.Union([t.Literal('published'), t.Literal('degraded')]),
  snapshotStatus: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('blocked'), t.Literal('unknown')])
})

const externalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

/**
 * forced relay proof path 暴露独立 route：eligibility 只给 CommandWell 展示态，execute 负责高风险闭环。
 */
export function createForcedRelayRoutes(
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'policyAuthorize'
    | 'log'
    | 'ingestOperationalEvent'
    | 'describeForcedRelayNode'
  >
) {
  return new Elysia({ prefix: '/api/v0' })
    .post(
      '/forced-relay/eligibility',
      async ({ body, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) {
          return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        }

        const eligibility = await deriveForcedRelayEligibility(deps, { nodeId: body.nodeId })
        return eligibility as never
      },
      {
        body: forcedRelayBodySchema,
        response: {
          200: forcedRelayEligibilitySchema,
          401: externalErrorSchema,
          503: externalErrorSchema
        }
      }
    )
    .post(
      '/forced-relay/change',
      async ({ body, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) {
          return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        }

        const result = await executeForcedRelayChange(deps, { actor, body })
        if ('kind' in result) {
          if (isMigrationRequiredFailure(result)) {
            set.status = result.status
            return externalMigrationRequiredRouteBody(result.error.migration)
          }
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }
        return result
      },
      {
        body: forcedRelayBodySchema,
        response: {
          200: forcedRelayResultSchema,
          401: externalErrorSchema,
          403: externalErrorSchema,
          404: externalErrorSchema,
          409: t.Union([externalErrorSchema, t.Object({
            error: t.Object({
              code: t.Literal('migration_required'),
              message: t.String(),
              correlationId: t.Optional(t.String()),
              migration: t.Any()
            })
          })]),
          503: externalErrorSchema
        }
      }
    )
}
