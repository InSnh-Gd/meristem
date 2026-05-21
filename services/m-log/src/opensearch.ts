// M-Log OpenSearch 适配器。私有模块，不对外暴露 DSL，只用于日志读模型投影与检索。
// Bun fetch 作为唯一 HTTP 客户端，禁止引入 Node.js HTTP/Agent 依赖。

import type {
  AuditLog,
  FullLog,
  FullLogSearchQuery,
  AuditSearchQuery,
  LogSearchResult,
  TimelineLog,
  TimelineSearchQuery
} from '../../../packages/contracts/src/index.ts'

// 三个投影索引名，Phase 10.0 固定 v0。
const INDEX_FULL = 'meristem-full-logs-v0'
const INDEX_TIMELINE = 'meristem-timeline-logs-v0'
const INDEX_AUDIT = 'meristem-audit-logs-v0'
// 硬上限防止无界查询压垮 OpenSearch。
const MAX_LIMIT = 100

// ---- 内部类型 ----

type HealthResponse = {
  status: string
  cluster_name: string
}

type IndexResult = {
  acknowledged: boolean
}

type SearchHit<T> = {
  _source: T
}

type SearchResponse<T> = {
  hits: {
    total: { value: number }
    hits: SearchHit<T>[]
  }
}

// ---- 适配器构造 ----

/**
 * OpenSearch 适配器只依赖 base URL 和 Bun fetch，不引入额外客户端库。
 * 所有方法失败时返回 null 或空结果，调用方据此判断 degraded 状态。
 */
export function createOpenSearchAdapter(baseUrl = 'http://127.0.0.1:9200') {
  const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T | null> => {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers
        }
      })
      if (!response.ok) return null
      return (await response.json()) as T
    } catch {
      return null
    }
  }

  // 健康检查
  async function health(): Promise<boolean> {
    const result = await fetchJson<HealthResponse>('/_cluster/health')
    return result !== null
  }

  // 建索引，幂等
  async function ensureIndex(index: string): Promise<boolean> {
    const head = await fetch(`${baseUrl}/${index}`, { method: 'HEAD' }).catch(() => null)
    if (head?.ok) return true

    const result = await fetchJson<IndexResult>(`/${index}`, {
      method: 'PUT',
      body: JSON.stringify({
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: { dynamic: 'strict', properties: indexMapping(index) }
      })
    })
    return result?.acknowledged === true
  }

  async function ensureAllIndices(): Promise<boolean> {
    const results = await Promise.all([
      ensureIndex(INDEX_FULL),
      ensureIndex(INDEX_TIMELINE),
      ensureIndex(INDEX_AUDIT)
    ])
    return results.every(Boolean)
  }

  async function indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<boolean> {
    const result = await fetchJson<{ result: string }>(`/${index}/_doc/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(doc)
    })
    return result?.result === 'created' || result?.result === 'updated'
  }

  // ---- 投影写入 ----

  async function indexFullLog(entry: FullLog): Promise<boolean> {
    return indexDocument(INDEX_FULL, entry.id, {
      timestamp: entry.timestamp,
      level: entry.level,
      source: entry.source,
      message: entry.message,
      correlationId: entry.correlationId ?? null,
      traceId: entry.traceId ?? null,
      payload: entry.payload ?? null
    })
  }

  async function indexTimelineLog(entry: TimelineLog): Promise<boolean> {
    return indexDocument(INDEX_TIMELINE, entry.id, {
      timestamp: entry.timestamp,
      summary: entry.summary,
      subject: entry.subject ?? null,
      correlationId: entry.correlationId ?? null
    })
  }

  async function indexAuditLog(entry: AuditLog): Promise<boolean> {
    return indexDocument(INDEX_AUDIT, entry.id, {
      timestamp: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      decisionId: entry.decisionId ?? null,
      result: entry.result,
      correlationId: entry.correlationId ?? null,
      traceId: entry.traceId ?? null,
      payload: entry.payload ?? null
    })
  }

  // ---- 搜索 ----

  function mustClauses(filters: Record<string, unknown>): unknown[] {
    return Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([field, value]) => ({ term: { [field]: value } }))
  }

  async function searchFull(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null> {
    const must: unknown[] = [...mustClauses({
      level: query.level,
      source: query.source,
      correlationId: query.correlationId,
      traceId: query.traceId
    })]

    if (query.q) must.push({ match: { message: query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<FullLog>>(`/${INDEX_FULL}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map((h) => h._source),
      total: response.hits.total.value
    }
  }

  async function searchTimeline(query: TimelineSearchQuery): Promise<LogSearchResult<TimelineLog> | null> {
    const must: unknown[] = [...mustClauses({
      subject: query.subject,
      correlationId: query.correlationId
    })]

    if (query.q) must.push({ match: { summary: query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<TimelineLog>>(`/${INDEX_TIMELINE}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map((h) => h._source),
      total: response.hits.total.value
    }
  }

  async function searchAudit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null> {
    const must: unknown[] = [...mustClauses({
      actor: query.actor,
      action: query.action,
      resource: query.resource,
      decisionId: query.decisionId,
      correlationId: query.correlationId
    })]

    if (query.q) must.push({ match: { 'result': query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<AuditLog>>(`/${INDEX_AUDIT}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map((h) => h._source),
      total: response.hits.total.value
    }
  }

  return {
    health,
    ensureAllIndices,
    indexFullLog,
    indexTimelineLog,
    indexAuditLog,
    searchFull,
    searchTimeline,
    searchAudit
  }
}

export type OpenSearchAdapter = ReturnType<typeof createOpenSearchAdapter>

// ---- 私有辅助 ----

function indexMapping(index: string): Record<string, unknown> {
  const kv: Record<string, { type: string }> = { timestamp: { type: 'date' } }
  switch (index) {
    case INDEX_FULL:
      Object.assign(kv, {
        level: { type: 'keyword' },
        source: { type: 'keyword' },
        message: { type: 'text' },
        correlationId: { type: 'keyword' },
        traceId: { type: 'keyword' }
      })
      break
    case INDEX_TIMELINE:
      Object.assign(kv, {
        summary: { type: 'text' },
        subject: { type: 'keyword' },
        correlationId: { type: 'keyword' }
      })
      break
    case INDEX_AUDIT:
      Object.assign(kv, {
        actor: { type: 'keyword' },
        action: { type: 'keyword' },
        resource: { type: 'keyword' },
        decisionId: { type: 'keyword' },
        result: { type: 'text' },
        correlationId: { type: 'keyword' },
        traceId: { type: 'keyword' }
      })
      break
  }
  return { properties: kv }
}

function buildSearchBody(must: unknown[], query: { from?: string; to?: string; limit?: number }): unknown {
  const rangeFilter: Record<string, unknown> = {}
  if (query.from || query.to) {
    rangeFilter['timestamp'] = {}
    if (query.from) (rangeFilter['timestamp'] as Record<string, string>)['gte'] = query.from
    if (query.to) (rangeFilter['timestamp'] as Record<string, string>)['lte'] = query.to
  }

  const filters = Object.keys(rangeFilter).length > 0 ? [rangeFilter] : []

  return {
    query: {
      bool: {
        must: must.length > 0 ? must : [{ match_all: {} }],
        filter: filters
      }
    },
    size: Math.min(query.limit ?? 50, MAX_LIMIT),
    sort: [{ timestamp: 'desc' }]
  }
}
