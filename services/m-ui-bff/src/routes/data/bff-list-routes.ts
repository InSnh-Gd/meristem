import * as Schema from 'effect/Schema'
import { Elysia, t } from 'elysia'
import {
  ApprovalListResponseSchema,
  AuditLogListResponseSchema,
  CreateNetworkResponseSchema,
  MNetProfileListResponseSchema,
  NetworkListResponseSchema,
  NodeListResponseSchema,
  PolicyDecisionSchema,
  ServiceListResponseSchema,
  TimelineLogListResponseSchema
} from '../../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../../deps.ts'
import type { StateSourceMetadata } from '../../types.ts'
import {
  bffError,
  fetchDecodedUpstream,
  fetchDecodedUpstreamAllow404,
  passthroughCoreError,
  requireBearerToken,
  requireObjectRecord,
  withStateSource,
  withStateSourceDetail
} from '../_shared/route-helpers.ts'

const PolicyDecisionListResponseSchema = Schema.Struct({
  decisions: Schema.Array(PolicyDecisionSchema)
})

/**
 * createBffListRoutes 负责 BFF 列表读模型：只补 stateSource，不改变上游事实归属。
 */
export function createBffListRoutes({ cf, cfRaw }: MUiBffRouteDeps) {
  return (
    new Elysia()
      .get(
        '/api/v0/nodes',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/nodes',
            token,
            schema: NodeListResponseSchema,
            errorMessage: 'Core returned invalid node list payload'
          })
          if (decoded instanceof Response) return decoded
          const nodes = decoded.nodes.map(node =>
            withStateSource(node, {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/nodes/${node.id}`
            })
          )
          return {
            nodes,
            stateSource: {
              sourceType: 'authoritative',
              sourceId: 'core:/api/v0/nodes'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped node list' }
        }
      )
      .get(
        '/api/v0/timeline',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/logs/timeline',
            token,
            schema: TimelineLogListResponseSchema,
            errorMessage: 'Core returned invalid timeline payload'
          })
          if (decoded instanceof Response) return decoded
          const entries = decoded.entries.map(entry =>
            withStateSource(entry, {
              sourceType: 'log',
              sourceId: `core:/api/v0/logs/timeline/${entry.id}`,
              ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
            })
          )
          return {
            entries,
            stateSource: {
              sourceType: 'log',
              sourceId: 'core:/api/v0/logs/timeline'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped timeline entries' }
        }
      )
      .get(
        '/api/v0/audit',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/audit',
            token,
            schema: AuditLogListResponseSchema,
            errorMessage: 'Core returned invalid audit payload'
          })
          if (decoded instanceof Response) return decoded
          const entries = decoded.entries.map(entry =>
            withStateSource(entry, {
              sourceType: 'audit',
              sourceId: `core:/api/v0/audit/${entry.id}`,
              ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
            })
          )
          return {
            entries,
            stateSource: {
              sourceType: 'audit',
              sourceId: 'core:/api/v0/audit'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped audit entries' }
        }
      )
      .get(
        '/api/v0/policy/decisions',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          // Core 当前没有决策列表 facade；先保留 404 空列表语义，再让现有解码 helper 处理其它分支。
          const decisionListProbe = await cfRaw('/api/v0/policy/decisions', token)
          const decoded =
            decisionListProbe.status === 404
              ? null
              : await fetchDecodedUpstreamAllow404({
                  fetcher: cf,
                  path: '/api/v0/policy/decisions',
                  token,
                  schema: PolicyDecisionListResponseSchema,
                  errorMessage: 'Core returned invalid policy decision list payload'
                })
          const decisions =
            decoded === null
              ? []
              : decoded instanceof Response
                ? decoded
                : decoded.decisions.map(decision =>
                    withStateSource(decision, {
                      sourceType: 'policy',
                      sourceId: `core:/api/v0/policy/decisions/${decision.id}`
                    })
                  )
          if (decisions instanceof Response) return decisions
          return {
            decisions,
            stateSource: {
              sourceType: 'policy',
              sourceId: 'core:/api/v0/policy/decisions'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped policy decision list' }
        }
      )
      .get(
        '/api/v0/policy/approvals',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/policy/approvals',
            token,
            schema: ApprovalListResponseSchema,
            errorMessage: 'Core returned invalid approval list payload'
          })
          if (decoded instanceof Response) return decoded
          const approvals = decoded.approvals.map(approval =>
            withStateSource(
              { ...approval, approvalId: approval.id },
              {
                sourceType: 'policy',
                sourceId: `core:/api/v0/policy/approvals/${approval.id}`
              }
            )
          )
          return {
            approvals,
            stateSource: {
              sourceType: 'policy',
              sourceId: 'core:/api/v0/policy/approvals'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped approval queue' }
        }
      )
      .get(
        '/api/v0/network-profiles',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/network-profiles',
            token,
            schema: MNetProfileListResponseSchema,
            errorMessage: 'Core returned invalid network profile list payload'
          })
          if (decoded instanceof Response) return decoded
          const profiles = decoded.profiles.map(profile =>
            withStateSource(profile, {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/network-profiles/${profile.profileVersion}`
            })
          )
          return {
            profiles,
            stateSource: {
              sourceType: 'authoritative',
              sourceId: 'core:/api/v0/network-profiles'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped network profile list' }
        }
      )
      .get(
        '/api/v0/networks/profile-defaults',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token

          // 全局默认由 Core facade 授权后转发；BFF 只补充展示来源。
          const result = await cf('/api/v0/networks/profile-defaults', token)
          if (!result.ok) return passthroughCoreError(result)
          const defaults = requireObjectRecord(
            result.data,
            'Core returned invalid global profile defaults payload'
          )
          if (defaults instanceof Response) return defaults
          return withStateSource(defaults, {
            sourceType: 'authoritative',
            sourceId: 'core:/api/v0/networks/profile-defaults'
          })
        },
        {
          detail: { summary: 'Read global network profile defaults through Core facade' }
        }
      )
      .get(
        '/api/v0/networks/profile-switches/:operationId',
        async ({ params, headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token

          // 迁移状态只经过 Core facade，不暴露 M-Net 内部路径或数据面承诺。
          const result = await cf(`/api/v0/networks/profile-switches/${params.operationId}`, token)
          if (!result.ok) return passthroughCoreError(result)
          const switchState = requireObjectRecord(
            result.data,
            'Core returned invalid profile switch payload'
          )
          if (switchState instanceof Response) return switchState
          return withStateSource(switchState, {
            sourceType: 'authoritative',
            sourceId: `core:/api/v0/networks/profile-switches/${params.operationId}`
          })
        },
        {
          params: t.Object({ operationId: t.String({ minLength: 1 }) }),
          detail: { summary: 'Read global network profile switch status through Core facade' }
        }
      )
      .get(
        '/api/v0/services',
        async ({ headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const decoded = await fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/services',
            token,
            schema: ServiceListResponseSchema,
            errorMessage: 'Core returned invalid service list payload'
          })
          if (decoded instanceof Response) return decoded
          const services = decoded.services.map(service =>
            withStateSource(service, {
              sourceType: 'authoritative',
              sourceId: `core:/api/v0/services/${service.id}`
            })
          )
          return {
            services,
            stateSource: {
              sourceType: 'authoritative',
              sourceId: 'core:/api/v0/services'
            } satisfies StateSourceMetadata
          }
        },
        {
          detail: { summary: 'Read display-shaped service list' }
        }
      )
      .get('/api/v0/networks', async ({ headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return fetchDecodedUpstream({
          fetcher: cf,
          path: '/api/v0/networks',
          token,
          schema: NetworkListResponseSchema,
          errorMessage: 'Core returned invalid network list payload'
        })
      })
      // 网络创建是 CommandWell 之外的直连写路径：BFF 只做认证与响应解码，事实由 Core/M-Net 拥有
      .post(
        '/api/v0/networks',
        async ({ body, headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          return fetchDecodedUpstream({
            fetcher: cf,
            path: '/api/v0/networks',
            token,
            schema: CreateNetworkResponseSchema,
            errorMessage: 'Core returned invalid network creation payload',
            init: { method: 'POST', body: JSON.stringify(body) }
          })
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1 }),
            profileVersion: t.Optional(t.String({ minLength: 1 }))
          }),
          detail: withStateSourceDetail('Create a logical network through Core facade', [
            'policy',
            'audit'
          ])
        }
      )
      // 网络生命周期写路径统一透传 Core facade：BFF 不改变错误事实，也不合成成功
      .delete(
        '/api/v0/networks/:id',
        async ({ params, headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const result = await cfRaw(`/api/v0/networks/${encodeURIComponent(params.id)}`, token, {
            method: 'DELETE'
          })
          if (result.status >= 400) return result
          try {
            return await result.json()
          } catch {
            return bffError(
              502,
              'bff.invalid_upstream_response',
              'Upstream service returned invalid JSON'
            )
          }
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          detail: withStateSourceDetail(
            'Delete an empty, profile-disabled network through Core facade',
            ['policy', 'audit']
          )
        }
      )
      .delete(
        '/api/v0/networks/:id/members/:nodeId',
        async ({ params, headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const result = await cfRaw(
            `/api/v0/networks/${encodeURIComponent(params.id)}/members/${encodeURIComponent(params.nodeId)}`,
            token,
            { method: 'DELETE' }
          )
          if (result.status >= 400) return result
          try {
            return await result.json()
          } catch {
            return bffError(
              502,
              'bff.invalid_upstream_response',
              'Upstream service returned invalid JSON'
            )
          }
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }), nodeId: t.String({ minLength: 1 }) }),
          detail: withStateSourceDetail('Remove a node from a network through Core facade', [
            'policy',
            'audit'
          ])
        }
      )
      .patch(
        '/api/v0/networks/:id',
        async ({ params, body, headers }) => {
          const token = requireBearerToken(headers)
          if (token instanceof Response) return token
          const result = await cfRaw(`/api/v0/networks/${encodeURIComponent(params.id)}`, token, {
            method: 'PATCH',
            body: JSON.stringify(body)
          })
          if (result.status >= 400) return result
          try {
            return await result.json()
          } catch {
            return bffError(
              502,
              'bff.invalid_upstream_response',
              'Upstream service returned invalid JSON'
            )
          }
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          body: t.Object({ displayName: t.Optional(t.String({ minLength: 1 })) }),
          detail: withStateSourceDetail('Update network metadata through Core facade', [
            'policy',
            'audit'
          ])
        }
      )
  )
}
