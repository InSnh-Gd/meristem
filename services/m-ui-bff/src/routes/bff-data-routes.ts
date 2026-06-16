import { Elysia, t } from 'elysia'
import type {
  ActorId,
  ApprovalDetailResponse,
  AuditLog,
  CoreDependencies,
  CoreMode,
  MinimalPolicyDecisionSummary,
  MNetRegionalProfile,
  MNode,
  Permission,
  PolicyApproval,
  PolicyDecision,
  ServiceSummary,
  TimelineLog
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import type { StateSourceMetadata } from '../types.ts'
import {
  bearerTokenFromHeaders,
  bffError,
  passthroughCoreError,
  withStateSource
} from './route-helpers.ts'
import { idParamsSchema } from './route-schemas.ts'

/**
 * createBffDataRoutes 负责 BFF 展示读模型：只补 stateSource，不改变 Core/M-Log/Audit 事实归属。
 */
export function createBffDataRoutes({ cf }: MUiBffRouteDeps) {
  return new Elysia()
    .get(
      '/api/v0/nodes',
      async ({ headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/nodes', token)
        if (!result.ok) return passthroughCoreError(result)
        const nodes = (result.data as { nodes: MNode[] }).nodes.map(node =>
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/logs/timeline', token)
        if (!result.ok) return passthroughCoreError(result)
        const entries = (result.data as { entries: TimelineLog[] }).entries.map(entry =>
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/audit', token)
        if (!result.ok) return passthroughCoreError(result)
        const entries = (result.data as { entries: AuditLog[] }).entries.map(entry =>
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/policy/decisions', token)
        if (!result.ok && result.status !== 404) return passthroughCoreError(result)
        const decisions = result.ok
          ? (result.data as { decisions: PolicyDecision[] }).decisions.map(decision =>
              withStateSource(decision, {
                sourceType: 'policy',
                sourceId: `core:/api/v0/policy/decisions/${decision.id}`
              })
            )
          : []
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/policy/approvals', token)
        if (!result.ok) return passthroughCoreError(result)
        const approvals = (result.data as { approvals: PolicyApproval[] }).approvals.map(approval =>
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        // BFF 底层命中 Core facade 的标准 `/api/v0/network-profiles`。
        const result = await cf('/api/v0/network-profiles', token)
        if (!result.ok) return passthroughCoreError(result)
        const profiles = (result.data as { profiles: MNetRegionalProfile[] }).profiles.map(
          profile =>
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
      '/api/v0/services',
      async ({ headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf('/api/v0/services', token)
        if (!result.ok) return passthroughCoreError(result)
        const services = (result.data as { services: ServiceSummary[] }).services.map(service =>
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
    .get('/api/v0/overview', async ({ headers }) => {
      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      const [sessionRes, statusRes, nodesRes, servicesRes, timelineRes] = await Promise.all([
        cf('/api/v0/session', token),
        cf('/api/v0/status', token),
        cf('/api/v0/nodes', token),
        cf('/api/v0/services', token),
        cf('/api/v0/logs/timeline', token)
      ])

      if (!sessionRes.ok) return passthroughCoreError(sessionRes)
      if (!statusRes.ok) return passthroughCoreError(statusRes)

      const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }
      const status = statusRes.data as {
        core: { id: string; version: string; mode: CoreMode }
        dependencies: CoreDependencies
        counts: { services: number; nodes: number; tasks: number }
      }
      const nodes = nodesRes.ok ? (nodesRes.data as { nodes: MNode[] }).nodes : []
      const services = servicesRes.ok
        ? (servicesRes.data as { services: ServiceSummary[] }).services
        : []
      const timeline = timelineRes.ok
        ? (timelineRes.data as { entries: TimelineLog[] }).entries
        : []

      const auditAccessible = session.permissions.includes('audit:read') as boolean

      // 如果当前会话有 audit:read 权限，拉取审计日志；失败时置 null 不阻塞 overview。
      let auditEntries = null
      if (auditAccessible) {
        const auditRes = await cf('/api/v0/audit', token)
        auditEntries = auditRes.ok ? (auditRes.data as { entries: unknown[] }).entries : null
      }

      return {
        session,
        core: status.core,
        dependencies: status.dependencies,
        nodes,
        services,
        timeline,
        auditAccessible,
        audit: auditEntries,
        stateSources: {
          session: 'authoritative' as const,
          core: 'authoritative' as const,
          dependencies: 'authoritative' as const,
          nodes: 'authoritative' as const,
          services: 'authoritative' as const,
          timeline: 'log' as const,
          audit: 'audit' as const
        }
      }
    })
    .get(
      '/api/v0/nodes/:id',
      async ({ params, headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf(`/api/v0/nodes/${params.id}`, token)
        if (!result.ok) return passthroughCoreError(result)
        return {
          ...(result.data as Record<string, unknown>),
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf(`/api/v0/policy/approvals/${params.id}`, token)
        if (!result.ok) return passthroughCoreError(result)
        const approvalDetail = result.data as ApprovalDetailResponse
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf(`/api/v0/policy/decisions/${params.id}`, token)
        if (!result.ok) return passthroughCoreError(result)

        const full = (result.data as { decision: MinimalPolicyDecisionSummary }).decision
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        // BFF detail 只读转发到 Core facade。
        const result = await cf(`/api/v0/network-profiles/${params.profileVersion}`, token)
        if (!result.ok) return passthroughCoreError(result)
        return withStateSource(result.data as MNetRegionalProfile, {
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
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await cf(`/api/v0/policy/decisions/${params.id}`, token)
        if (!result.ok) return passthroughCoreError(result)
        return withStateSource(
          (result.data as { decision: MinimalPolicyDecisionSummary }).decision,
          {
            sourceType: 'policy',
            sourceId: `core:/api/v0/policy/decisions/${params.id}`
          }
        )
      },
      {
        params: idParamsSchema,
        detail: { summary: 'Read full policy decision with state source' }
      }
    )
}
