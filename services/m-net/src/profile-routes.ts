import { Elysia, t } from 'elysia'
import type { MNetAppDeps } from './deps.ts'
import { executeBreakGlassDisable, requireBreakGlassDeps } from './profile-break-glass-workflow.ts'
import {
  isProfileWorkflowFailure as isEnableDisableFailure,
  requestNetworkProfileChange,
  requireProfileReadDeps,
  requireProfileWriteDeps
} from './profile-enable-disable-workflows.ts'
import { isProfileWorkflowFailure, type ProfileReadDeps } from './profile-workflow-types.ts'
import { externalApiError, verifyBearerAuth } from './route-helpers.ts'
import {
  breakGlassDisableBodySchema,
  breakGlassDisableResponseSchema,
  disablePolicyBodySchema,
  disablePolicyResponseSchema,
  externalBreakGlassErrorResponses,
  externalReadErrorResponses,
  externalWriteErrorResponses,
  networkIdParamsSchema,
  profileVersionParamsSchema,
  setNetworkProfileBodySchema,
  setNetworkProfileResponseSchema
} from './route-schemas.ts'

type ProfileReadRouteFailure = {
  status: 400 | 401 | 403 | 404 | 409 | 503
  code: string
  message: string
}

async function requireAuthorizedProfileReadContext(
  deps: Pick<MNetAppDeps, 'profileStore' | 'policyAuthorize'>,
  input: { headers: Record<string, string | undefined>; resource: string }
): Promise<{ profileDeps: ProfileReadDeps } | ProfileReadRouteFailure> {
  const actor = await verifyBearerAuth(input.headers)
  if (!actor) {
    return {
      status: 401,
      code: 'auth.invalid_token',
      message: 'invalid or missing bearer token'
    }
  }
  const profileDeps = requireProfileReadDeps(deps)
  if (isEnableDisableFailure(profileDeps)) {
    return {
      status: profileDeps.status,
      code: profileDeps.error.code,
      message: profileDeps.error.message
    }
  }
  const policyResult = await profileDeps.policyAuthorize.authorize(
    actor,
    'network:profile-read',
    input.resource
  )
  if (policyResult.result !== 'allow') {
    return {
      status: 403,
      code: 'policy.denied',
      message: `read denied: ${policyResult.reasons.join(', ')}`
    }
  }

  return { profileDeps }
}

/**
 * 对外 REST API 只暴露 profile 查询与切换；JWT、M-Policy、M-Log、M-EventBus 顺序必须保持稳定。
 */
export function createProfileRoutes(
  deps: Pick<
    MNetAppDeps,
    | 'profileStore'
    | 'suspendedOps'
    | 'approvals'
    | 'policyAuthorize'
    | 'events'
    | 'log'
    | 'profileDisablePolicy'
    | 'policyHealthCheck'
    | 'networkUpdater'
    | 'listMembers'
  >
) {
  return (
    new Elysia({ prefix: '/api/v0' })
      // ── Profile Disable Policy Config ──
      .put(
        '/networks/profile-disable-policy',
        async ({ body, headers, set }) => {
          const actor = await verifyBearerAuth(headers)
          if (!actor)
            return externalApiError(
              set,
              401,
              'auth.invalid_token',
              'invalid or missing bearer token'
            )
          if (!deps.profileDisablePolicy)
            return externalApiError(
              set,
              503,
              'feature.unavailable',
              'disable policy features are not available'
            )

          // Only admin / security-admin can configure policy
          if (actor !== 'admin' && actor !== 'security-admin') {
            return externalApiError(
              set,
              403,
              'policy.denied',
              'only admin and security-admin can configure disable policy'
            )
          }

          const policy = await deps.profileDisablePolicy.setPolicy(body)
          await deps.log?.writeAudit(
            actor,
            'mnet.profile.disable-policy.configure',
            'network:profile-disable-policy',
            'success',
            undefined,
            policy
          )
          return policy
        },
        {
          body: disablePolicyBodySchema,
          response: {
            200: disablePolicyResponseSchema,
            401: externalReadErrorResponses[401],
            403: externalReadErrorResponses[403],
            503: externalReadErrorResponses[503]
          }
        }
      )
      .get(
        '/network-profiles',
        async ({ headers, set }) => {
          const context = await requireAuthorizedProfileReadContext(deps, {
            headers,
            resource: 'network-profiles'
          })
          if ('status' in context) {
            return externalApiError(set, context.status, context.code, context.message)
          }

          const defs = await context.profileDeps.profileStore.getDefinitions()
          return { profiles: defs }
        },
        {
          response: { 200: t.Object({ profiles: t.Array(t.Any()) }), ...externalReadErrorResponses }
        }
      )
      .get(
        '/network-profiles/:profileVersion',
        async ({ params, headers, set }) => {
          const context = await requireAuthorizedProfileReadContext(deps, {
            headers,
            resource: `network-profile:${params.profileVersion}`
          })
          if ('status' in context) {
            return externalApiError(set, context.status, context.code, context.message)
          }

          const def = await context.profileDeps.profileStore.getDefinition(params.profileVersion)
          if (!def) return externalApiError(set, 404, 'profile.not_found', 'profile not found')
          return def
        },
        {
          params: profileVersionParamsSchema,
          response: {
            200: t.Any(),
            ...externalReadErrorResponses
          }
        }
      )
      .post(
        '/networks/:id/profile',
        async ({ params, body, headers, set }) => {
          const actor = await verifyBearerAuth(headers)
          if (!actor)
            return externalApiError(
              set,
              401,
              'auth.invalid_token',
              'invalid or missing bearer token'
            )
          const profileDeps = requireProfileWriteDeps(deps)
          if (isEnableDisableFailure(profileDeps))
            return externalApiError(
              set,
              profileDeps.status,
              profileDeps.error.code,
              profileDeps.error.message
            )
          const result = await requestNetworkProfileChange(profileDeps, {
            actor,
            networkId: params.id,
            body
          })
          if (isEnableDisableFailure(result))
            return externalApiError(set, result.status, result.error.code, result.error.message)
          return result
        },
        {
          params: networkIdParamsSchema,
          body: setNetworkProfileBodySchema,
          response: {
            200: setNetworkProfileResponseSchema,
            ...externalWriteErrorResponses
          }
        }
      )
      // ── Break-Glass Emergency Disable Route ──
      .post(
        '/networks/:id/profile/disable-break-glass',
        async ({ params, body, headers, set }) => {
          const actor = await verifyBearerAuth(headers)
          if (!actor)
            return externalApiError(
              set,
              401,
              'auth.invalid_token',
              'invalid or missing bearer token'
            )
          const breakGlassDeps = requireBreakGlassDeps(deps)
          if (isProfileWorkflowFailure(breakGlassDeps))
            return externalApiError(
              set,
              breakGlassDeps.status,
              breakGlassDeps.error.code,
              breakGlassDeps.error.message
            )
          const result = await executeBreakGlassDisable(breakGlassDeps, {
            actor,
            networkId: params.id,
            body
          })
          if (isProfileWorkflowFailure(result))
            return externalApiError(set, result.status, result.error.code, result.error.message)
          return result
        },
        {
          params: networkIdParamsSchema,
          body: breakGlassDisableBodySchema,
          response: {
            200: breakGlassDisableResponseSchema,
            ...externalBreakGlassErrorResponses
          }
        }
      )
  )
}
