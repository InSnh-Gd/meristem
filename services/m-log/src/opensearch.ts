// M-Log OpenSearch 适配器。私有模块，不对外暴露 DSL，只用于日志读模型投影与检索。
// Bun fetch 作为唯一 HTTP 客户端，禁止引入 Node.js HTTP/Agent 依赖。
// 使用 schema 版本规则（meristem-{type}-logs-v{N}）与 index alias 机制。

import type {
  AuditLog,
  AuditSearchQuery,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  TimelineLog,
  TimelineSearchQuery
} from '../../../packages/contracts/src/index.ts'

// 当前活跃索引版本
const SCHEMA_VERSION = 1

// 索引名使用 versioned 命名：meristem-{type}-logs-v{N}
// §2.7 schema 变更时创建新索引版本，不原地修改
const INDEX_FULL = `meristem-full-logs-v${SCHEMA_VERSION}`
const INDEX_TIMELINE = `meristem-timeline-logs-v${SCHEMA_VERSION}`
const INDEX_AUDIT = `meristem-audit-logs-v${SCHEMA_VERSION}`

// alias 指向当前活跃版本，便于无需版本感知的查询
const ALIAS_FULL = 'meristem-full-logs-latest'
const ALIAS_TIMELINE = 'meristem-timeline-logs-latest'
const ALIAS_AUDIT = 'meristem-audit-logs-latest'

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
 * 索引名采用 versioned 命名 + alias 机制。
 */
export function createOpenSearchAdapter(baseUrl = 'http://127.0.0.1:9200') {
  const warnOpenSearchFallback = (operation: string, error: unknown) => {
    console.warn(
      `m-log: OpenSearch ${operation} degraded - ${error instanceof Error ? error.message : String(error)}`
    )
  }

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
    } catch (error) {
      warnOpenSearchFallback(`request ${init?.method ?? 'GET'} ${path}`, error)
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
    const head = await fetch(`${baseUrl}/${index}`, { method: 'HEAD' }).catch(error => {
      warnOpenSearchFallback(`HEAD ${index}`, error)
      return null
    })
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

  /**
   * 创建/更新 index alias，指向当前活跃版本。
   */
  async function ensureAlias(index: string, alias: string): Promise<boolean> {
    // 先获取当前 alias 指向的索引
    const existing = await fetchJson<Record<string, { aliases: Record<string, unknown> }>>(
      `/_alias/${encodeURIComponent(alias)}`
    )
    // 移除旧的 alias 绑定
    if (existing) {
      for (const oldIndex of Object.keys(existing)) {
        if (oldIndex !== index) {
          await fetchJson(`/_aliases`, {
            method: 'POST',
            body: JSON.stringify({
              actions: [{ remove: { index: oldIndex, alias } }]
            })
          })
        }
      }
    }

    // 绑定新索引到 alias
    const result = await fetchJson<IndexResult>(`/_aliases`, {
      method: 'POST',
      body: JSON.stringify({
        actions: [{ add: { index, alias } }]
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
    if (!results.every(Boolean)) return false

    // 创建 alias
    const aliasResults = await Promise.all([
      ensureAlias(INDEX_FULL, ALIAS_FULL),
      ensureAlias(INDEX_TIMELINE, ALIAS_TIMELINE),
      ensureAlias(INDEX_AUDIT, ALIAS_AUDIT)
    ])
    return aliasResults.every(Boolean)
  }

  // idempotency key 由调用方（projection engine）传入，这里不再自生成。
  // indexDocument 接受显式 id 参数作为 OpenSearch _id。
  async function indexDocument(
    index: string,
    id: string,
    doc: Record<string, unknown>
  ): Promise<boolean> {
    const result = await fetchJson<{ result: string }>(`/${index}/_doc/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(doc)
    })
    return result?.result === 'created' || result?.result === 'updated'
  }

  // ---- 投影写入 ----
  // idempotency key 格式为 {index}:{factId}:{version}
  // 调用方负责传入幂等 key，这里使用 fact.entry.id 作为文档 _id。

  async function indexFullLog(entry: FullLog): Promise<boolean> {
    const id = `${INDEX_FULL}:${entry.id}:1`
    return indexDocument(INDEX_FULL, id, {
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
    const id = `${INDEX_TIMELINE}:${entry.id}:1`
    return indexDocument(INDEX_TIMELINE, id, {
      timestamp: entry.timestamp,
      summary: entry.summary,
      subject: entry.subject ?? null,
      correlationId: entry.correlationId ?? null
    })
  }

  async function indexAuditLog(entry: AuditLog): Promise<boolean> {
    const id = `${INDEX_AUDIT}:${entry.id}:1`
    return indexDocument(INDEX_AUDIT, id, {
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
  // 搜索对 alias 执行，query 方无需关心版本号。

  function mustClauses(filters: Record<string, unknown>): unknown[] {
    return Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([field, value]) => ({ term: { [field]: value } }))
  }

  async function searchFull(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null> {
    const must: unknown[] = [
      ...mustClauses({
        level: query.level,
        source: query.source,
        correlationId: query.correlationId,
        traceId: query.traceId
      })
    ]

    if (query.q) must.push({ match: { message: query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<FullLog>>(`/${ALIAS_FULL}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map(h => h._source),
      total: response.hits.total.value
    }
  }

  async function searchTimeline(
    query: TimelineSearchQuery
  ): Promise<LogSearchResult<TimelineLog> | null> {
    const must: unknown[] = [
      ...mustClauses({
        subject: query.subject,
        correlationId: query.correlationId
      })
    ]

    if (query.q) must.push({ match: { summary: query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<TimelineLog>>(`/${ALIAS_TIMELINE}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map(h => h._source),
      total: response.hits.total.value
    }
  }

  async function searchAudit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null> {
    const must: unknown[] = [
      ...mustClauses({
        actor: query.actor,
        action: query.action,
        resource: query.resource,
        decisionId: query.decisionId,
        correlationId: query.correlationId
      })
    ]

    if (query.q) must.push({ match: { result: query.q } })

    const body = buildSearchBody(must, query)
    const response = await fetchJson<SearchResponse<AuditLog>>(`/${ALIAS_AUDIT}/_search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!response) return null
    return {
      entries: response.hits.hits.map(h => h._source),
      total: response.hits.total.value
    }
  }

  return {
    health,
    ensureAllIndices,
    ensureIndex,
    ensureAlias,
    indexDocument,
    indexFullLog,
    indexTimelineLog,
    indexAuditLog,
    searchFull,
    searchTimeline,
    searchAudit,
    // 暴露索引版本信息
    getCurrentVersion: () => SCHEMA_VERSION,
    getAliases: () => ({
      full: ALIAS_FULL,
      timeline: ALIAS_TIMELINE,
      audit: ALIAS_AUDIT
    }),
    getIndexNames: () => ({
      full: INDEX_FULL,
      timeline: INDEX_TIMELINE,
      audit: INDEX_AUDIT
    })
  }
}

export type OpenSearchAdapter = ReturnType<typeof createOpenSearchAdapter>

// ---- 私有辅助 ----

function indexMapping(index: string): Record<string, unknown> {
  const kv: Record<string, { type: string }> = { timestamp: { type: 'date' } }
  if (index.includes('full-logs')) {
    Object.assign(kv, {
      level: { type: 'keyword' },
      source: { type: 'keyword' },
      message: { type: 'text' },
      correlationId: { type: 'keyword' },
      traceId: { type: 'keyword' }
    })
  } else if (index.includes('timeline-logs')) {
    Object.assign(kv, {
      summary: { type: 'text' },
      subject: { type: 'keyword' },
      correlationId: { type: 'keyword' }
    })
  } else if (index.includes('audit-logs')) {
    Object.assign(kv, {
      actor: { type: 'keyword' },
      action: { type: 'keyword' },
      resource: { type: 'keyword' },
      decisionId: { type: 'keyword' },
      result: { type: 'text' },
      correlationId: { type: 'keyword' },
      traceId: { type: 'keyword' }
    })
  }
  return { properties: kv }
}

function buildSearchBody(
  must: unknown[],
  query: { from?: string; to?: string; limit?: number }
): unknown {
  const rangeFilter: Record<string, unknown> = {}
  if (query.from || query.to) {
    rangeFilter.timestamp = {}
    if (query.from) (rangeFilter.timestamp as Record<string, string>).gte = query.from
    if (query.to) (rangeFilter.timestamp as Record<string, string>).lte = query.to
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
