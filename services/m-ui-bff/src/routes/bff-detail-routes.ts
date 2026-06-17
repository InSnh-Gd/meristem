import { Elysia, t } from 'elysia'
import {
  ApprovalDetailResponseSchema,
  MNetProfileDetailResponseSchema,
  NodeDetailResponseSchema,
  PolicyDecisionResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MinimalPolicyDecisionSummary } from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import { fetchDecodedUpstream, requireBearerToken, withStateSource } from './route-helpers.ts'
import { idParamsSchema } from './route-schemas.ts'

/**
 * createBffDetailRoutes 负责单对象详情读模型，保持 Core 错误和数据形状透传。
 */
export function createBffDetailRoutes({ cf }: MUiBffRouteDeps) {
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
