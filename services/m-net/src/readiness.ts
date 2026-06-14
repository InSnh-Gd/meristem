import { fetchReadyState, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import type { MNetSqlClient } from './clients.ts'

/**
 * ready 探针必须同时验证 PostgreSQL、M-EventBus 与 M-Log，避免 Core 只看到单点存活误判服务可用。
 */
export function createReadinessProbe(client: MNetSqlClient) {
  const warnReadinessFallback = (dependency: string, error: unknown) => {
    console.warn(
      `m-net: ${dependency} readiness probe degraded - ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return async function readiness(): Promise<{ ready: boolean }> {
    const postgresReady = await client`select 1`
      .then(() => true)
      .catch(error => {
        warnReadinessFallback('postgres', error)
        return false
      })
    const [eventBusReady, logReady] = await Promise.all([
      fetchReadyState(`${serviceUrl('m-eventbus')}/ready`),
      fetchReadyState(`${serviceUrl('m-log')}/ready`)
    ])
    return { ready: postgresReady && eventBusReady && logReady }
  }
}
