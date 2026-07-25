import * as Schema from 'effect/Schema'
import { Elysia } from 'elysia'
import { MDeployDigestSchema } from '../../../../packages/contracts/src/schemas/mdeploy-common.ts'
import { MDeployInfrastructureTopologyV01Schema } from '../../../../packages/contracts/src/schemas/mdeploy-infrastructure.ts'
import { MDeployEvidenceMetadataV01Schema } from '../../../../packages/contracts/src/schemas/mdeploy-operations.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  deployApplyBodySchema,
  deployRollbackBodySchema
} from './mdeploy-management-route-schemas.ts'
import { fetchDecodedUpstream, requireBearerToken } from './route-helpers.ts'

const desiredStateSummarySchema = Schema.Struct({
  latestDigest: Schema.optional(MDeployDigestSchema),
  lastSuccessfulDigest: Schema.optional(MDeployDigestSchema),
  syncedAt: Schema.optional(Schema.String),
  stale: Schema.Boolean,
  controllerAvailable: Schema.Boolean
})

const operationSchema = Schema.Struct({
  operationId: Schema.String,
  kind: Schema.Literal('apply', 'rollback'),
  agentId: Schema.String,
  status: Schema.Literal('queued', 'running', 'succeeded', 'failed', 'blocked'),
  policyDecisionId: Schema.String,
  auditId: Schema.String,
  correlationId: Schema.String,
  createdAt: Schema.String,
  completedAt: Schema.optional(Schema.String)
})

const operationResponseSchema = Schema.Struct({ operation: operationSchema })
const topologyResponseSchema = Schema.Struct({ topology: MDeployInfrastructureTopologyV01Schema })
const historyResponseSchema = Schema.Struct({
  evidence: Schema.Array(MDeployEvidenceMetadataV01Schema)
})

const topologyStateSource = {
  sourceType: 'authoritative' as const,
  sourceId: 'core:/api/v0/deploy/infrastructure/topology'
}

/**
 * M-Deploy BFF 路由只适配 Core public facade 的已验证事实；操作授权、策略和审计继续由下游持有。
 * 复用 MUiBffRouteDeps.cf 作为 Core fetcher，与其它 BFF 路由共享同一个注入点。
 */
export function createBffMDeployManagementRoutes({ cf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/deploy/topology',
      async ({ headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const decoded = await fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/deploy/infrastructure/topology',
          token,
          schema: topologyResponseSchema,
          errorMessage: 'Core returned invalid M-Deploy topology payload'
        })
        if (decoded instanceof Response) return decoded

        return { ...decoded, stateSource: topologyStateSource }
      },
      { detail: { summary: 'Read M-Deploy infrastructure topology' } }
    )
    .get(
      '/api/v0/deploy/status',
      async ({ headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const status = await fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/deploy/desired-state',
          token,
          schema: desiredStateSummarySchema,
          errorMessage: 'Core returned invalid M-Deploy desired-state status'
        })
        if (status instanceof Response) return status

        return {
          status,
          stateSource: {
            sourceType: 'authoritative' as const,
            sourceId: 'core:/api/v0/deploy/desired-state'
          }
        }
      },
      { detail: { summary: 'Read M-Deploy desired-state status' } }
    )
    .get(
      '/api/v0/deploy/history',
      async ({ headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const history = await fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/deploy/evidence',
          token,
          schema: historyResponseSchema,
          errorMessage: 'Core returned invalid M-Deploy evidence history'
        })
        if (history instanceof Response) return history

        return {
          ...history,
          stateSource: {
            sourceType: 'audit' as const,
            sourceId: 'core:/api/v0/deploy/evidence'
          }
        }
      },
      { detail: { summary: 'Read M-Deploy deployment evidence history' } }
    )
    .post(
      '/api/v0/deploy/apply',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        return fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/deploy/apply',
          token,
          init: { method: 'POST', body: JSON.stringify(body) },
          schema: operationResponseSchema,
          errorMessage: 'Core returned invalid M-Deploy apply result'
        })
      },
      { body: deployApplyBodySchema, detail: { summary: 'Schedule a policy-audited deployment' } }
    )
    .post(
      '/api/v0/deploy/rollback',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        return fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/deploy/rollback',
          token,
          init: { method: 'POST', body: JSON.stringify(body) },
          schema: operationResponseSchema,
          errorMessage: 'Core returned invalid M-Deploy rollback result'
        })
      },
      {
        body: deployRollbackBodySchema,
        detail: { summary: 'Schedule a policy-audited deployment rollback' }
      }
    )
}
