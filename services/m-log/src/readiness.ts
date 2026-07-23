import type { OpenSearchReadModelStatus } from './opensearch-read-model.ts'

export type MLogReadinessDependencies = {
  checkPostgres(): Promise<boolean>
  checkNats(): Promise<boolean>
  checkEventBus(): Promise<boolean>
  refreshOpenSearch(): Promise<OpenSearchReadModelStatus>
}

/**
 * M-Log readiness 仅依赖权威写路径和事件依赖；OpenSearch 状态单独返回，避免搜索故障误阻断日志事实。
 */
export function createMLogReadiness(deps: MLogReadinessDependencies) {
  return async function readiness(): Promise<{
    ready: boolean
    opensearch: OpenSearchReadModelStatus
  }> {
    const [postgresReady, natsReady, eventBusReady, opensearch] = await Promise.all([
      deps.checkPostgres(),
      deps.checkNats(),
      deps.checkEventBus(),
      deps.refreshOpenSearch()
    ])

    return {
      ready: postgresReady && natsReady && eventBusReady,
      opensearch
    }
  }
}
