import { Elysia, t } from 'elysia'
import { CoreError } from '../core-error.ts'
import type { CoreDeps } from '../types.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { apiErrorSchema, policyDecisionSchema, protectedRouteDetail, protectedResponse } from '../schemas.ts'

export function policyRoutes(deps: CoreDeps) {
  return new Elysia()
    .get('/api/v0/policy/decisions/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers)
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `policy-decision:${params.id}`, correlationId: auth.correlationId },
      )
      const decision = await deps.policy.getDecision(params.id)
      if (!decision.ok) throw new CoreError(503, decision.error.code, decision.error.message, auth.correlationId)
      if (!decision.value) throw new CoreError(404, 'policy_decision.not_found', 'policy decision not found', auth.correlationId)
      return { decision: decision.value }
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: protectedResponse(t.Object({ decision: policyDecisionSchema }), { 404: apiErrorSchema, 503: apiErrorSchema }),
      detail: protectedRouteDetail('Read one policy decision')
    })
}
