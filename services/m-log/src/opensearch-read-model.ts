import { createLogger, recordGauge } from '../../../packages/telemetry/src/index.ts'
import type { OpenSearchAdapter } from './opensearch.ts'

const logger = createLogger('m-log')

export type OpenSearchReadModelStatus = 'ready' | 'degraded' | 'unavailable'

type OpenSearchReadModelAdapter = Pick<OpenSearchAdapter, 'clusterHealth' | 'ensureAllIndices'>

/**
 * 维护 OpenSearch 读模型的独立可用性状态；该状态绝不能参与 PostgreSQL 日志事实写入的判定。
 */
export function createOpenSearchReadModel(adapter: OpenSearchReadModelAdapter) {
  let initialized = false
  let currentStatus: OpenSearchReadModelStatus = 'unavailable'

  function setStatus(status: OpenSearchReadModelStatus): OpenSearchReadModelStatus {
    currentStatus = status
    recordGauge('meristem_opensearch_projection_degraded', status === 'ready' ? 0 : 1)
    return currentStatus
  }

  /**
   * 探测集群并在首次恢复时补齐索引；yellow 集群仍可查询和投影，但必须对操作者显示降级。
   */
  async function refresh(): Promise<OpenSearchReadModelStatus> {
    const clusterStatus = await adapter.clusterHealth().catch(error => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'opensearch_health_probe_failed'
      )
      return 'unavailable' as const
    })

    if (clusterStatus === 'unavailable') {
      initialized = false
      return setStatus('unavailable')
    }

    if (!initialized) {
      const indicesReady = await adapter.ensureAllIndices().catch(error => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'opensearch_index_bootstrap_failed'
        )
        return false
      })
      if (!indicesReady) return setStatus('unavailable')
      initialized = true
    }

    return setStatus(clusterStatus)
  }

  /** 投影写入失败只使读模型降级，下一次 readiness 探测可恢复该状态。 */
  function markUnavailable(): void {
    initialized = false
    setStatus('unavailable')
  }

  return {
    refresh,
    markUnavailable,
    isAvailable: () => currentStatus !== 'unavailable',
    status: () => currentStatus
  }
}

export type OpenSearchReadModel = ReturnType<typeof createOpenSearchReadModel>
