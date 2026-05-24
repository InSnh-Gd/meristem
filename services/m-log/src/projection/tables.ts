import { auditLogs, fullLogs, timelineLogs } from '../../../../packages/db/src/schema.ts'

export type FactTableName = 'timeline_logs' | 'full_logs' | 'audit_logs'

// Projection backfill uses PostgreSQL fact tables as source of truth; OpenSearch remains a read model.
export const factTables = {
  timeline_logs: timelineLogs,
  full_logs: fullLogs,
  audit_logs: auditLogs
} as const

/**
 * Resolves the authoritative fact table from a projection index name.
 * Source: docs/roadmap/PHASE-10.1.md projection index naming.
 */
export function factTableFromIndex(index: string): FactTableName | null {
  if (index.startsWith('meristem-timeline-logs')) return 'timeline_logs'
  if (index.startsWith('meristem-full-logs')) return 'full_logs'
  if (index.startsWith('meristem-audit-logs')) return 'audit_logs'
  return null
}

