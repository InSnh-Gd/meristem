import {
  fetchReadyState,
  probePostgresReadiness,
  serviceUrl,
  warnDegradedAndReturn
} from '../../../packages/internal-http/src/index.ts'
import type { MNetSqlClient } from './clients.ts'

/**
 * ready 探针必须同时验证 PostgreSQL、M-EventBus 与 M-Log，避免 Core 只看到单点存活误判服务可用。
 */
export function createReadinessProbe(
  client: MNetSqlClient,
  checkStoreHealth?: () => Promise<boolean>
) {
  return async function readiness(): Promise<{ ready: boolean }> {
    const postgresReady = await probePostgresReadiness({
      client,
      service: 'm-net',
      readyValue: true,
      fallback: false,
      warn: ({ message }) => console.warn(message)
    })
    const storesReady = checkStoreHealth
      ? await checkStoreHealth().catch(error =>
          warnDegradedAndReturn({
            service: 'm-net',
            target: 'stores',
            error,
            context: 'readiness probe degraded',
            fallback: false,
            warn: ({ message }) => console.warn(message)
          })
        )
      : true
    const [eventBusReady, logReady] = await Promise.all([
      fetchReadyState(`${serviceUrl('m-eventbus')}/ready`),
      fetchReadyState(`${serviceUrl('m-log')}/ready`)
    ])
    return { ready: postgresReady && storesReady && eventBusReady && logReady }
  }
}
