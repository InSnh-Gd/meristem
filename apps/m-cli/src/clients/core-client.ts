import type {
  ProjectionHealth,
  ServiceListResponse,
  ServiceReloadResponse
} from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'
import { unwrap } from './shared.ts'

/**
 * Core 域客户端保留健康、状态、服务和日志入口，避免 facade 重新拼 HTTP 细节。
 */
export function createCoreDomainClient(
  runtime: CliRuntime
): Pick<
  CliClient,
  | 'health'
  | 'ready'
  | 'status'
  | 'listServices'
  | 'reloadService'
  | 'listTimeline'
  | 'listAudit'
  | 'projectionHealth'
> {
  const { client, headers, serviceRoutes } = runtime

  return {
    health: async () => unwrap(client.api.v0.health.get({})),
    ready: async () => unwrap(client.api.v0.ready.get({})),
    status: async () => unwrap(client.api.v0.status.get({ $headers: headers })),
    listServices: async () =>
      unwrap<ServiceListResponse>(client.api.v0.services.get({ $headers: headers })),
    reloadService: async (serviceId, reason) => {
      const route = serviceRoutes[serviceId]
      if (!route) throw new Error('service route unavailable')
      return unwrap<ServiceReloadResponse>(
        route.reload.post({ ...(reason ? { reason } : {}), $headers: headers })
      )
    },
    listTimeline: async () => unwrap(client.api.v0.logs.timeline.get({ $headers: headers })),
    listAudit: async () => unwrap(client.api.v0.audit.get({ $headers: headers })),
    projectionHealth: async () =>
      unwrap<{ indices: ProjectionHealth[] }>(
        client.api.v0.projection.health.get({ $headers: headers })
      )
  }
}
