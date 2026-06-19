import { Elysia, t } from 'elysia'
import type { MinimalPolicyDecisionSummaryFromSchema as MinimalPolicyDecisionSummary } from '../../../../packages/contracts/src/index.ts'
import {
  ApprovalDetailResponseSchema,
  EventBusPublishMetricsSummarySchema,
  MNetProfileDetailResponseSchema,
  NodeDetailResponseSchema,
  PolicyDecisionResponseSchema,
  PolicyInternalSummarySchema,
  ProjectionHealthResponseSchema,
  ServiceListResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  decodeUpstreamData,
  fetchDecodedUpstream,
  requireBearerToken,
  withStateSource
} from './route-helpers.ts'
import { idParamsSchema } from './route-schemas.ts'

/**
 * createBffDetailRoutes 负责单对象详情读模型，保持 Core 错误和数据形状透传。
 */
export function createBffDetailRoutes({ cf, ef, pf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/nodes/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const decoded = await fetchDecodedUpstream({
          fetcher: cf,
          path: `/api/v0/nodes/${params.id}`,
          token,
          schema: NodeDetailResponseSchema,
          errorMessage: 'Core returned invalid node detail payload'
        })
        if (decoded instanceof Response) return decoded
        return {
          ...decoded,
          stateSource: {
            sourceType: 'authoritative',
            sourceId: `core:/api/v0/nodes/${params.id}`
          }
        }
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read single node detail' }
      }
    )
    .get(
      '/api/v0/services/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const services = await fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/services',
          token,
          schema: ServiceListResponseSchema,
          errorMessage: 'Core returned invalid service list payload'
        })
        if (services instanceof Response) return services

        const matched = services.services.find(service => service.id === params.id)
        if (!matched) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'service.not_found',
                message: `Service ${params.id} not found`
              }
            }),
            {
              status: 404,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        let eventBusMetrics = null as
          | import('../../../../packages/contracts/src/index.ts').EventBusPublishMetricsSummaryFromSchema
          | null
        let eventBusMetricsStateSource = null as {
          sourceType: 'read-model'
          sourceId: string
        } | null
        let logProjectionHealth = null as
          | import('../../../../packages/contracts/src/index.ts').ProjectionHealthResponseFromSchema
          | null
        let logProjectionHealthStateSource = null as {
          sourceType: 'read-model'
          sourceId: string
        } | null
        let policySummary = null as
          | import('../../../../packages/contracts/src/index.ts').PolicyInternalSummaryFromSchema
          | null
        let policySummaryStateSource = null as { sourceType: 'policy'; sourceId: string } | null
        if (params.id === 'm-eventbus') {
          const eventBusMetricsRes = await ef('/internal/v0/metrics/publish-summary')
          if (eventBusMetricsRes.ok) {
            const decodedEventBusMetrics = decodeUpstreamData(
              EventBusPublishMetricsSummarySchema,
              eventBusMetricsRes.data,
              'M-EventBus returned invalid publish metrics payload'
            )
            if (decodedEventBusMetrics instanceof Response) return decodedEventBusMetrics
            eventBusMetrics = decodedEventBusMetrics
            eventBusMetricsStateSource = {
              sourceType: 'read-model',
              sourceId: 'm-eventbus:/internal/v0/metrics/publish-summary'
            }
          }
        } else if (params.id === 'm-log') {
          const projectionHealth = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/projection/health',
            token,
            schema: ProjectionHealthResponseSchema,
            errorMessage: 'Core returned invalid projection health payload'
          })
          if (projectionHealth instanceof Response) return projectionHealth
          logProjectionHealth = projectionHealth
          logProjectionHealthStateSource = {
            sourceType: 'read-model',
            sourceId: 'core:/api/v0/projection/health'
          }
        } else if (params.id === 'm-policy') {
          const policySummaryRes = await pf('/internal/v0/summary')
          if (!policySummaryRes.ok) {
            return new Response(JSON.stringify(policySummaryRes.data), {
              status: policySummaryRes.status || 502,
              headers: { 'content-type': 'application/json' }
            })
          }
          const decodedPolicySummary = decodeUpstreamData(
            PolicyInternalSummarySchema,
            policySummaryRes.data,
            'M-Policy returned invalid summary payload'
          )
          if (decodedPolicySummary instanceof Response) return decodedPolicySummary
          policySummary = decodedPolicySummary
          policySummaryStateSource = {
            sourceType: 'policy',
            sourceId: 'm-policy:/internal/v0/summary'
          }
        }

        const response: import('../../../../packages/contracts/src/index.ts').ServiceInspectorResponseFromSchema =
          {
            service: withStateSource(matched, {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/services/${params.id}`
            }),
            eventBusMetrics,
            eventBusMetricsStateSource,
            logProjectionHealth,
            logProjectionHealthStateSource,
            policySummary,
            policySummaryStateSource
          }

        return response
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read one service detail with optional EventBus metrics' }
      }
    )
    .get(
      '/api/v0/policy/approvals/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const approvalDetail = await fetchDecodedUpstream({
          fetcher: cf,
          path: `/api/v0/policy/approvals/${params.id}`,
          token,
          schema: ApprovalDetailResponseSchema,
          errorMessage: 'Core returned invalid approval detail payload'
        })
        if (approvalDetail instanceof Response) return approvalDetail
        return withStateSource(
          {
            ...approvalDetail,
            approvalId: approvalDetail.id,
            votes: approvalDetail.votes.map(vote => ({
              ...vote,
              stateSource: {
                sourceType: 'policy' as const,
                sourceId: `core:/api/v0/policy/approvals/${params.id}/votes/${vote.id}`
              }
            }))
          },
          {
            sourceType: 'policy',
            sourceId: `core:/api/v0/policy/approvals/${params.id}`
          }
        )
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read full policy approval with state source' }
      }
    )
    .get(
      '/api/v0/policy/decisions/:id/summary',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const decoded = await fetchDecodedUpstream({
          fetcher: cf,
          path: `/api/v0/policy/decisions/${params.id}`,
          token,
          schema: PolicyDecisionResponseSchema,
          errorMessage: 'Core returned invalid policy decision payload'
        })
        if (decoded instanceof Response) return decoded
        const full = decoded.decision
        const decision: MinimalPolicyDecisionSummary = {
          id: full.id,
          actor: full.actor,
          action: full.action,
          resource: full.resource,
          result: full.result,
          createdAt: full.createdAt
        }

        return { decision }
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read policy decision summary (reasons redacted)' }
      }
    )
    .get(
      '/api/v0/network-profiles/:profileVersion',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const profile = await fetchDecodedUpstream({
          fetcher: cf,
          path: `/api/v0/network-profiles/${params.profileVersion}`,
          token,
          schema: MNetProfileDetailResponseSchema,
          errorMessage: 'Core returned invalid network profile detail payload'
        })
        if (profile instanceof Response) return profile
        return withStateSource(profile, {
          sourceType: 'authoritative',
          sourceId: `core:/api/v0/network-profiles/${params.profileVersion}`
        })
      },
      {
        params: t.Object({ profileVersion: t.String({ minLength: 1 }) }),
        detail: { summary: 'Read one network profile with state source' }
      }
    )
    .get(
      '/api/v0/policy/decisions/:id',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const decoded = await fetchDecodedUpstream({
          fetcher: cf,
          path: `/api/v0/policy/decisions/${params.id}`,
          token,
          schema: PolicyDecisionResponseSchema,
          errorMessage: 'Core returned invalid policy decision payload'
        })
        if (decoded instanceof Response) return decoded
        return withStateSource(decoded.decision, {
          sourceType: 'policy',
          sourceId: `core:/api/v0/policy/decisions/${params.id}`
        })
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read full policy decision with state source' }
      }
    )
}
