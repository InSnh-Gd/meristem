import { edenTreaty } from '@elysiajs/eden'
import { Effect, Either } from 'effect'
import * as Schema from 'effect/Schema'
import {
  type PolicyDecision,
  PolicyDecisionResponseSchema,
  PolicyDecisionSchema
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { PolicyApp } from '../../../../services/m-policy/src/public-types.ts'
import {
  createInternalFetcher,
  errorMessageFromHttpResponse,
  requireServiceData,
  requireServiceRoute,
  runServiceEffect,
  tryServiceCall
} from '../effect-helpers.ts'
import type { CoreDeps } from '../types.ts'

const invalidPolicyDecisionFailure = {
  code: 'policy.invalid_response',
  message: 'M-Policy returned invalid decision payload'
} as const

function toMutablePolicyDecision(decision: typeof PolicyDecisionSchema.Type): PolicyDecision {
  return {
    id: decision.id,
    actor: decision.actor,
    action: decision.action,
    resource: decision.resource,
    result: decision.result,
    reasons: [...decision.reasons],
    ...(decision.operationDangerLevel !== undefined
      ? { operationDangerLevel: decision.operationDangerLevel }
      : {}),
    ...(decision.suspicionScore !== undefined ? { suspicionScore: decision.suspicionScore } : {}),
    ...(decision.riskFactors !== undefined ? { riskFactors: [...decision.riskFactors] } : {}),
    ...(decision.requiredAction !== undefined ? { requiredAction: decision.requiredAction } : {}),
    createdAt: decision.createdAt
  }
}

function decodePolicyDecision(value: unknown) {
  const decoded = Schema.decodeUnknownEither(PolicyDecisionSchema)(value)
  return Either.isRight(decoded)
    ? Effect.succeed(toMutablePolicyDecision(decoded.right))
    : Effect.fail(invalidPolicyDecisionFailure)
}

function decodePolicyDecisionResponse(value: unknown) {
  const decoded = Schema.decodeUnknownEither(PolicyDecisionResponseSchema)(value)
  return Either.isRight(decoded)
    ? Effect.succeed(toMutablePolicyDecision(decoded.right.decision))
    : Effect.fail(invalidPolicyDecisionFailure)
}

/**
 * Core 到 M-Policy 的同步调用已经收敛到 loopback HTTP + Eden。
 * 这里统一把内部服务错误折叠成 Core 可消费的 Result 形状。
 */
export function createHttpPolicyPort() {
  const client = edenTreaty<PolicyApp>(serviceUrl('m-policy'), { fetcher: createInternalFetcher() })

  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.authorize.post(input), {
          code: 'policy.unavailable',
          message: 'M-Policy unavailable'
        }).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, {
              code: 'policy.unavailable',
              message: 'M-Policy unavailable'
            })
          ),
          Effect.flatMap(decodePolicyDecisionResponse)
        )
      )
    },
    async getDecision(id: string) {
      const routes = client.internal.v0.decisions as Record<
        string,
        {
          get(params: Record<string, never>): Promise<{
            data: PolicyDecision | null
            error: { value: unknown; status: number } | null
            status: number
          }>
        }
      >
      return runServiceEffect(
        requireServiceRoute(routes[id], {
          code: 'policy.unavailable',
          message: 'M-Policy unavailable'
        }).pipe(
          Effect.flatMap(route =>
            tryServiceCall(() => route.get({}), {
              code: 'policy.unavailable',
              message: 'M-Policy unavailable'
            })
          ),
          Effect.flatMap(response => {
            if (response.error?.status === 404 || response.status === 404)
              return Effect.succeed(null)
            return response.error
              ? Effect.fail({
                  code: 'policy.unavailable',
                  message: errorMessageFromHttpResponse(
                    response.error.value,
                    'M-Policy unavailable'
                  )
                })
              : response.data
                ? decodePolicyDecision(response.data)
                : Effect.succeed(null)
          })
        )
      )
    }
  }
}
