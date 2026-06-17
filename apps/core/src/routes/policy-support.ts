import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import type { CoreDeps } from '../types.ts'

export async function requirePolicyDecisionReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  decisionId: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'core:read',
    resource: `policy-decision:${decisionId}`,
    correlationId: auth.correlationId
  })
  return auth
}

export async function readPolicyDecisionOrThrow(
  deps: CoreDeps,
  decisionId: string,
  correlationId: string
) {
  const decision = await deps.policy.getDecision(decisionId)
  if (!decision.ok) {
    throw new CoreError(503, decision.error.code, decision.error.message, correlationId)
  }
  if (!decision.value) {
    throw new CoreError(
      404,
      'policy_decision.not_found',
      'policy decision not found',
      correlationId
    )
  }
  return decision.value
}
