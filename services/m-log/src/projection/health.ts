import { differenceInSeconds, parseISO } from 'date-fns'
import { eq, gte, sql } from 'drizzle-orm'
import type {
  ProjectionCursor,
  ProjectionHealth
} from '../../../../packages/contracts/src/index.ts'
import { projectionDLQ } from '../../../../packages/db/src/schema.ts'
import { createLogger, recordGauge } from '../../../../packages/telemetry/src/index.ts'
import { columnOf } from './dynamic-column.ts'
import { factTableFromIndex, factTables } from './tables.ts'
import type { ProjectionDatabase, ProjectionOpenSearch } from './types.ts'

const logger = createLogger('m-log')

type CursorReader = {
  getCursor(index: string): Promise<ProjectionCursor | null>
}

/**
 * Creates projection health calculation and metric recording.
 */
export function createProjectionHealthService(
  db: ProjectionDatabase,
  os: ProjectionOpenSearch,
  cursors: CursorReader
) {
  async function getProjectionHealth(): Promise<ProjectionHealth[]> {
    const indices = ['meristem-timeline-logs-v0', 'meristem-full-logs-v0', 'meristem-audit-logs-v0']
    const results: ProjectionHealth[] = []

    // OpenSearch 探测优先消费三态 healthStatus：yellow 集群仍可投影，但必须对操作者显示降级；
    // 仅暴露布尔 health 的适配器无法区分降级，只能按 available/unavailable 归一。
    // 生产装配中 healthStatus 来自 readModel.refresh() 的实时探测（每次调用发 /_cluster/health
    // 请求，恢复期还会补建索引），调用方需评估轮询成本。
    const osStatus = os.healthStatus
      ? await os.healthStatus().catch(error => {
          logger.warn(
            {
              error: error instanceof Error ? error.message : String(error)
            },
            'opensearch_health_probe_failed'
          )
          return 'unavailable' as const
        })
      : os.health
        ? (await os.health().catch(error => {
            logger.warn(
              {
                error: error instanceof Error ? error.message : String(error)
              },
              'opensearch_health_probe_failed'
            )
            return false
          }))
          ? 'ready'
          : 'unavailable'
        : 'ready'
    const osAvailable = osStatus !== 'unavailable'

    for (const index of indices) {
      const cursor = await cursors.getCursor(index)
      const dlqCount =
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(projectionDLQ)
            .where(eq(projectionDLQ.index, index))
        )[0]?.count ?? 0

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
            .where(gte(columnOf(table, 'timestamp'), new Date(cursor.timestamp)))
          pendingCount = countResult[0]?.count ?? 0

          lagSeconds = differenceInSeconds(new Date(), parseISO(cursor.timestamp), {
            roundingMethod: 'floor'
          })
        }
      }

      const status = resolveHealthStatus({
        osAvailable,
        osDegraded: osStatus === 'degraded',
        dlqCount,
        lagSeconds
      })

      recordGauge('projection.lag_seconds', lagSeconds, { index })
      recordGauge('projection.pending_count', pendingCount, { index })
      recordGauge('projection.dlq_count', dlqCount, { index })

      results.push({ index, lagSeconds, lastProjectedAt, pendingCount, dlqCount, status })
    }

    return results
  }

  return { getProjectionHealth }
}

function resolveHealthStatus(input: {
  osAvailable: boolean
  osDegraded: boolean
  dlqCount: number
  lagSeconds: number
}): ProjectionHealth['status'] {
  if (!input.osAvailable) return 'unavailable'
  if (input.osDegraded || input.dlqCount > 0 || input.lagSeconds > 300) return 'degraded'
  return 'healthy'
}
