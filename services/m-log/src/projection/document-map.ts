type FactRow = {
  id?: unknown
  timestamp?: unknown
  summary?: unknown
  subject?: unknown
  correlation_id?: unknown
  level?: unknown
  source?: unknown
  message?: unknown
  trace_id?: unknown
  payload?: unknown
  actor?: unknown
  action?: unknown
  resource?: unknown
  decision_id?: unknown
  result?: unknown
}

/**
 * Maps PostgreSQL log facts into OpenSearch projection documents.
 * Source: docs/roadmap/PHASE-10.1.md document projection behavior.
 */
export function mapFactToDoc(index: string, row: FactRow): Record<string, unknown> {
  const timestamp = row.timestamp ? (row.timestamp as Date).toISOString() : new Date().toISOString()

  if (index.startsWith('meristem-timeline-logs')) {
    return {
      timestamp,
      summary: row.summary ?? '',
      subject: row.subject ?? null,
      correlationId: row.correlation_id ?? null
    }
  }

  if (index.startsWith('meristem-full-logs')) {
    return {
      timestamp,
      level: row.level ?? 'info',
      source: row.source ?? '',
      message: row.message ?? '',
      correlationId: row.correlation_id ?? null,
      traceId: row.trace_id ?? null,
      payload: row.payload ?? null
    }
  }

  if (index.startsWith('meristem-audit-logs')) {
    return {
      timestamp,
      actor: row.actor ?? 'system',
      action: row.action ?? '',
      resource: row.resource ?? '',
      decisionId: row.decision_id ?? null,
      result: row.result ?? '',
      correlationId: row.correlation_id ?? null,
      traceId: row.trace_id ?? null,
      payload: row.payload ?? null
    }
  }

  return {}
}

