import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import type {
  AuditLog,
  AuditSearchQuery,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  TimelineLog,
  TimelineSearchQuery
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { LogApp } from '../../../../services/m-log/src/public-types.ts'
import {
  createInternalFetcher,
  requireServiceData,
  runServiceEffect,
  tryServiceCall
} from '../effect-helpers.ts'

type SearchClient = {
  full: {
    get(params: { $query: Record<string, string> }): Promise<{
      data: LogSearchResult<FullLog> | null
      error: { value: unknown; status: number } | null
    }>
  }
  timeline: {
    get(params: { $query: Record<string, string> }): Promise<{
      data: LogSearchResult<TimelineLog> | null
      error: { value: unknown; status: number } | null
    }>
  }
  audit: {
    get(params: { $query: Record<string, string> }): Promise<{
      data: LogSearchResult<AuditLog> | null
      error: { value: unknown; status: number } | null
    }>
  }
}

/**
 * M-Log 仍然由 Core 编排审计与时间线写入，因此这里需要把内部 HTTP 契约
 * 包装成稳定的日志端口，而不是把 Elysia/Eden 细节泄漏给上层路由。
 */
export function createHttpLogPort() {
  const client = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher: createInternalFetcher() })

  return {
    async writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.timeline.post(input), {
          code: 'log.unavailable',
          message: 'M-Log unavailable'
        }).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, { code: 'log.unavailable', message: 'M-Log unavailable' })
          ),
          Effect.map(data => data.entry)
        )
      )
    },
    async writeFull(input: Omit<FullLog, 'id' | 'timestamp'>) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.full.post(input), {
          code: 'log.unavailable',
          message: 'M-Log unavailable'
        }).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, { code: 'log.unavailable', message: 'M-Log unavailable' })
          ),
          Effect.map(data => data.entry)
        )
      )
    },
    async writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.audit.post(input), {
          code: 'audit.unavailable',
          message: 'Audit Log unavailable'
        }).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, {
              code: 'audit.unavailable',
              message: 'Audit Log unavailable'
            })
          ),
          Effect.map(data => data.entry)
        )
      )
    },
    async listTimeline(limit?: number) {
      return runServiceEffect(
        tryServiceCall(
          () => client.internal.v0.timeline.get({ $query: limit === undefined ? {} : { limit } }),
          { code: 'log.unavailable', message: 'M-Log unavailable' }
        ).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, { code: 'log.unavailable', message: 'M-Log unavailable' })
          ),
          Effect.map(data => data.entries)
        )
      )
    },
    async listFull(limit?: number) {
      return runServiceEffect(
        tryServiceCall(
          () => client.internal.v0.full.get({ $query: limit === undefined ? {} : { limit } }),
          { code: 'log.unavailable', message: 'M-Log unavailable' }
        ).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, { code: 'log.unavailable', message: 'M-Log unavailable' })
          ),
          Effect.map(data => data.entries)
        )
      )
    },
    async listAudit(limit?: number) {
      return runServiceEffect(
        tryServiceCall(
          () => client.internal.v0.audit.get({ $query: limit === undefined ? {} : { limit } }),
          { code: 'log.unavailable', message: 'Audit Log unavailable' }
        ).pipe(
          Effect.flatMap(response =>
            requireServiceData(response, {
              code: 'log.unavailable',
              message: 'Audit Log unavailable'
            })
          ),
          Effect.map(data => data.entries)
        )
      )
    },
    async searchFull(query: FullLogSearchQuery) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const params: Record<string, string> = {}
            if (query.q) params.q = query.q
            if (query.from) params.from = query.from
            if (query.to) params.to = query.to
            if (query.limit !== undefined) params.limit = String(query.limit)
            if (query.level) params.level = query.level
            if (query.source) params.source = query.source
            if (query.correlationId) params.correlationId = query.correlationId
            if (query.traceId) params.traceId = query.traceId
            const response = await (client.internal.v0.search as SearchClient).full.get({
              $query: params
            })
            if (response.error || !response.data)
              throw { code: 'search.unavailable', message: 'search unavailable' }
            return response.data as LogSearchResult<FullLog>
          },
          { code: 'search.unavailable', message: 'search unavailable' }
        ).pipe(Effect.map(data => data))
      )
    },
    async searchTimeline(query: TimelineSearchQuery) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const params: Record<string, string> = {}
            if (query.q) params.q = query.q
            if (query.from) params.from = query.from
            if (query.to) params.to = query.to
            if (query.limit !== undefined) params.limit = String(query.limit)
            if (query.subject) params.subject = query.subject
            if (query.correlationId) params.correlationId = query.correlationId
            const response = await (client.internal.v0.search as SearchClient).timeline.get({
              $query: params
            })
            if (response.error || !response.data)
              throw { code: 'search.unavailable', message: 'search unavailable' }
            return response.data as LogSearchResult<TimelineLog>
          },
          { code: 'search.unavailable', message: 'search unavailable' }
        ).pipe(Effect.map(data => data))
      )
    },
    async searchAudit(query: AuditSearchQuery) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const params: Record<string, string> = {}
            if (query.q) params.q = query.q
            if (query.from) params.from = query.from
            if (query.to) params.to = query.to
            if (query.limit !== undefined) params.limit = String(query.limit)
            if (query.actor) params.actor = query.actor
            if (query.action) params.action = query.action
            if (query.resource) params.resource = query.resource
            if (query.decisionId) params.decisionId = query.decisionId
            if (query.correlationId) params.correlationId = query.correlationId
            const response = await (client.internal.v0.search as SearchClient).audit.get({
              $query: params
            })
            if (response.error || !response.data)
              throw { code: 'search.unavailable', message: 'search unavailable' }
            return response.data as LogSearchResult<AuditLog>
          },
          { code: 'search.unavailable', message: 'search unavailable' }
        ).pipe(Effect.map(data => data))
      )
    }
  }
}
