import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import type { PolicyDecision } from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { PolicyApp } from '../../../../services/m-policy/src/app.ts'
import type { CoreDeps } from '../types.ts'
import { createInternalFetcher, errorMessageFromHttpResponse, requireServiceData, requireServiceRoute, runServiceEffect, tryServiceCall } from '../effect-helpers.ts'

/**
 * Core 到 M-Policy 的同步调用已经收敛到 loopback HTTP + Eden。
 * 这里统一把内部服务错误折叠成 Core 可消费的 Result 形状。
 */
export function createHttpPolicyPort() {
  const client = edenTreaty<PolicyApp>(serviceUrl('m-policy'), { fetcher: createInternalFetcher() })

  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.authorize.post(input), { code: 'policy.unavailable', message: 'M-Policy unavailable' }).pipe(
          Effect.flatMap((response) => requireServiceData(response, { code: 'policy.unavailable', message: 'M-Policy unavailable' })),
          Effect.map((data) => data.decision)
        )
      )
    },
    async getDecision(id: string) {
      const routes = client.internal.v0.decisions as Record<
        string,
        { get(params: {}): Promise<{ data: PolicyDecision | null; error: { value: unknown; status: number } | null; status: number }> }
      >
      return runServiceEffect(
        requireServiceRoute(routes[id], { code: 'policy.unavailable', message: 'M-Policy unavailable' }).pipe(
          Effect.flatMap((route) =>
            tryServiceCall(() => route.get({}), { code: 'policy.unavailable', message: 'M-Policy unavailable' })
          ),
          Effect.flatMap((response) => {
            if (response.error?.status === 404 || response.status === 404) return Effect.succeed(null)
            return response.error
              ? Effect.fail({
                  code: 'policy.unavailable',
                  message: errorMessageFromHttpResponse(response.error.value, 'M-Policy unavailable')
                })
              : Effect.succeed(response.data ?? null)
          })
        )
      )
    }
  }
}
