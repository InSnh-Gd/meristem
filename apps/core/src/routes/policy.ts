import { Elysia, t } from 'elysia'
import {
  apiErrorSchema,
  policyDecisionSchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import { readPolicyDecisionOrThrow, requirePolicyDecisionReadAccess } from './policy-support.ts'

export function policyRoutes(deps: CoreDeps) {
  return new Elysia().get(
    '/api/v0/policy/decisions/:id',
    async ({ params, headers, status: _status }) => {
      const auth = await requirePolicyDecisionReadAccess(deps, headers, params.id)
      const decision = await readPolicyDecisionOrThrow(deps, params.id, auth.correlationId)
      return { decision }
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(t.Object({ decision: policyDecisionSchema }), {
        404: apiErrorSchema,
        503: apiErrorSchema
      }),
      detail: protectedRouteDetail('Read one policy decision')
    }
  )
}
