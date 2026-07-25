import { Elysia } from 'elysia'
import { MNetTopologyViewSchema } from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  fetchDecodedUpstream,
  requireBearerToken,
  withStateSourceDetail
} from './route-helpers.ts'
import {
  approveMnetJoinRequestBodySchema,
  mnetManagementJoinRequestParamsSchema,
  mnetManagementNetworkParamsSchema,
  rejectMnetJoinRequestBodySchema
} from './mnet-management-route-schemas.ts'
import {
  BffMNetJoinDecisionResponseSchema,
  toBffMNetManagementTopology
} from './mnet-management-support.ts'

/**
 * M-Net 管理 façade 只转发 M-Net 已公开的 closed-loop 契约。
 * M-Policy、Audit 和最终加入决定仍由 M-Net workflow 持有，BFF 不缓存或重算它们。
 */
export function createBffMNetManagementRoutes({ mf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/networks/:id/mnet-management/topology',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        const topology = await fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/mnet/closed-loop/networks/${encodeURIComponent(params.id)}/topology`,
          token,
          schema: MNetTopologyViewSchema,
          errorMessage: 'M-Net returned invalid closed-loop topology payload'
        })
        if (topology instanceof Response) return topology

        return toBffMNetManagementTopology(params.id, topology)
      },
      {
        params: mnetManagementNetworkParamsSchema,
        detail: withStateSourceDetail('Read M-Net topology and WireGuard runtime facts', [
          'read-model'
        ])
      }
    )
    .post(
      '/api/v0/networks/:id/mnet-management/join-requests/:requestId/approve',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        return fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/mnet/closed-loop/join-requests/${encodeURIComponent(params.requestId)}/decision`,
          token,
          init: { method: 'POST', body: JSON.stringify({ decision: 'approve', ...body }) },
          schema: BffMNetJoinDecisionResponseSchema,
          errorMessage: 'M-Net returned invalid join approval payload'
        })
      },
      {
        params: mnetManagementJoinRequestParamsSchema,
        body: approveMnetJoinRequestBodySchema,
        detail: withStateSourceDetail('Approve a pending M-Net node join through its public workflow', [
          'policy',
          'audit'
        ])
      }
    )
    .post(
      '/api/v0/networks/:id/mnet-management/join-requests/:requestId/reject',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token

        return fetchDecodedUpstream({
          fetcher: mf,
          path: `/api/v0/mnet/closed-loop/join-requests/${encodeURIComponent(params.requestId)}/decision`,
          token,
          init: { method: 'POST', body: JSON.stringify({ decision: 'reject', ...body }) },
          schema: BffMNetJoinDecisionResponseSchema,
          errorMessage: 'M-Net returned invalid join rejection payload'
        })
      },
      {
        params: mnetManagementJoinRequestParamsSchema,
        body: rejectMnetJoinRequestBodySchema,
        detail: withStateSourceDetail('Reject a pending M-Net node join through its public workflow', [
          'policy',
          'audit'
        ])
      }
    )
}
