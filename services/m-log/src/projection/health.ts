import { eq, gte, sql, type SQL } from 'drizzle-orm'
import { projectionDLQ } from '../../../../packages/db/src/schema.ts'
import type { ProjectionCursor, ProjectionHealth } from '../../../../packages/contracts/src/index.ts'
import { recordGauge } from '../../../../packages/telemetry/src/index.ts'
import { factTableFromIndex, factTables } from './tables.ts'
import type { ProjectionDatabase, ProjectionOpenSearch } from './types.ts'

type CursorReader = {
  getCursor(index: string): Promise<ProjectionCursor | null>
}

/**
 * Creates projection health calculation and metric recording.
 * Source: docs/roadmap/PHASE-10.1.md degraded-state observability.
 */
export function createProjectionHealthService(db: ProjectionDatabase, os: ProjectionOpenSearch, cursors: CursorReader) {
  async function getProjectionHealth(): Promise<ProjectionHealth[]> {
    const indices = ['meristem-timeline-logs-v0', 'meristem-full-logs-v0', 'meristem-audit-logs-v0']
    const results: ProjectionHealth[] = []

    const osAvailable = os.health ? await os.health().catch(() => false) : true

    for (const index of indices) {
      const cursor = await cursors.getCursor(index)
      const dlqCount = (await db.select({ count: sql<number>`count(*)` }).from(projectionDLQ).where(eq(projectionDLQ.index, index)))[0]?.count ?? 0

      let lagSeconds = 0
      let lastProjectedAt: string | null = null
      let pendingCount = 0

      if (cursor) {
        lastProjectedAt = cursor.timestamp
        const factTable = factTableFromIndex(index)
        if (factTable) {
          const table = factTables[factTable]
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(table)
            .where(gte(table['timestamp' as keyof typeof table] as unknown as SQL<unknown>, new Date(cursor.timestamp)))
          pendingCount = countResult[0]?.count ?? 0

          lagSeconds = Math.floor((Date.now() - new Date(cursor.timestamp).getTime()) / 1000)
        }
      }

      const status = resolveHealthStatus({ osAvailable, dlqCount, lagSeconds })

      recordGauge('projection.lag_seconds', lagSeconds, { index })
      recordGauge('projection.pending_count', pendingCount, { index })
      recordGauge('projection.dlq_count', dlqCount, { index })

      results.push({ index, lagSeconds, lastProjectedAt, pendingCount, dlqCount, status })
    }

    return results
  }

  return { getProjectionHealth }
}

function resolveHealthStatus(input: { osAvailable: boolean; dlqCount: number; lagSeconds: number }): ProjectionHealth['status'] {
  if (!input.osAvailable) return 'unavailable'
  if (input.dlqCount > 0 || input.lagSeconds > 300) return 'degraded'
  return 'healthy'
}

