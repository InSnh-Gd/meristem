import { Elysia } from 'elysia'
import {
  AuditLogListResponseSchema,
  NodeListResponseSchema,
  ServiceListResponseSchema,
  SessionResponseSchema,
  StatusResponseSchema,
  TimelineLogListResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  toOverviewAuditEntry,
  toOverviewNode,
  toOverviewService,
  toOverviewStatus,
  toOverviewTimelineEntry
} from './bff-data-support.ts'
import { decodeUpstreamData, passthroughCoreError, requireBearerToken } from './route-helpers.ts'

/**
 * createBffOverviewRoute 负责 overview 聚合读模型；失败映射沿用上游 Core 响应。
 */
export function createBffOverviewRoute({ cf }: MUiBffRouteDeps) {
  return new Elysia().get('/api/v0/overview', async ({ headers }) => {
    const token = requireBearerToken(headers)
    if (token instanceof Response) return token

    const [sessionRes, statusRes, nodesRes, servicesRes, timelineRes] = await Promise.all([
      cf('/api/v0/session', token),
      cf('/api/v0/status', token),
      cf('/api/v0/nodes', token),
      cf('/api/v0/services', token),
      cf('/api/v0/logs/timeline', token)
    ])

    if (!sessionRes.ok) return passthroughCoreError(sessionRes)
    if (!statusRes.ok) return passthroughCoreError(statusRes)

    const session = decodeUpstreamData(
      SessionResponseSchema,
      sessionRes.data,
      'Core returned invalid session payload'
    )
    if (session instanceof Response) return session
    const status = decodeUpstreamData(
      StatusResponseSchema,
      statusRes.data,
      'Core returned invalid status payload'
    )
    if (status instanceof Response) return status
    let nodes = [] as Array<ReturnType<typeof toOverviewNode>>
    if (nodesRes.ok) {
      const decodedNodes = decodeUpstreamData(
        NodeListResponseSchema,
        nodesRes.data,
        'Core returned invalid overview node list payload'
      )
      if (decodedNodes instanceof Response) return decodedNodes
      nodes = decodedNodes.nodes.map(toOverviewNode)
    }
    let services = [] as Array<ReturnType<typeof toOverviewService>>
    if (servicesRes.ok) {
      const decodedServices = decodeUpstreamData(
        ServiceListResponseSchema,
        servicesRes.data,
        'Core returned invalid overview service list payload'
      )
      if (decodedServices instanceof Response) return decodedServices
      services = decodedServices.services.map(toOverviewService)
    }
    let timeline = [] as Array<ReturnType<typeof toOverviewTimelineEntry>>
    if (timelineRes.ok) {
      const decodedTimeline = decodeUpstreamData(
        TimelineLogListResponseSchema,
        timelineRes.data,
        'Core returned invalid overview timeline payload'
      )
      if (decodedTimeline instanceof Response) return decodedTimeline
      timeline = decodedTimeline.entries.map(toOverviewTimelineEntry)
    }

    const auditAccessible = session.permissions.includes('audit:read')

    // 如果当前会话有 audit:read 权限，拉取审计日志；失败时置 null 不阻塞 overview。
    let auditEntries: Array<ReturnType<typeof toOverviewAuditEntry>> | null = null
    if (auditAccessible) {
      const auditRes = await cf('/api/v0/audit', token)
      if (auditRes.ok) {
        const decodedAudit = decodeUpstreamData(
          AuditLogListResponseSchema,
          auditRes.data,
          'Core returned invalid overview audit payload'
        )
        if (decodedAudit instanceof Response) return decodedAudit
        auditEntries = decodedAudit.entries.map(toOverviewAuditEntry)
      }
    }

    return {
      session,
      ...toOverviewStatus(status),
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
}
