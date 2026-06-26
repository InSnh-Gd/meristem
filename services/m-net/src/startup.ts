import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createAgentRuntime } from './agent-runtime.ts'
import { createMNetApp } from './app.ts'
import { createMNetInfrastructure } from './clients.ts'
import { heartbeatTimeoutMs, joinIngressPort } from './config.ts'
import { createWiredMigrationEngine } from './migration-engine-factory.ts'
import { requireDataPlaneDeps } from './mnet-dataplane-support.ts'
import { createNetworkService } from './network-service.ts'
import { createDbNodeControlStore } from './node-control-store.ts'
import { executeNodeControl } from './node-control-workflow.ts'
import { createReadinessProbe } from './readiness.ts'

/**
 * M-Net 启动装配统一放在这里：入口文件只触发启动，不再直接持有依赖接线与关闭序列。
 */
export async function startMNetService(): Promise<void> {
  const infrastructure = createMNetInfrastructure()
  const networkService = createNetworkService({
    db: infrastructure.db,
    profileStore: infrastructure.profileStore,
    globalDefaultsStore: infrastructure.globalDefaultsStore
  })
  const nodeRuntimeDataPlaneDeps = requireDataPlaneDeps({
    profileStore: infrastructure.profileStore,
    policyAuthorize: infrastructure.policyAuthorize,
    listMembers: networkService.listMembers,
    dataPlane: infrastructure.dataPlaneStores,
    events: infrastructure.profileEvents,
    log: infrastructure.profileLog,
    networkUpdater: networkService.networkUpdater
  })
  const agentRuntime = createAgentRuntime({
    db: infrastructure.db,
    publishEvent: infrastructure.publishEvent,
    writeTimeline: infrastructure.writeTimeline,
    writeFull: infrastructure.writeFull,
    writeAudit: infrastructure.writeAudit,
    dataPlaneDeps: 'kind' in nodeRuntimeDataPlaneDeps ? null : nodeRuntimeDataPlaneDeps
  })
  const readiness = createReadinessProbe(infrastructure.client, infrastructure.checkStoreHealth)
  const nodeControlStore = createDbNodeControlStore(infrastructure.db)
  const migrationEngine = createWiredMigrationEngine({
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    profileStore: infrastructure.profileStore,
    dataPlaneStores: infrastructure.dataPlaneStores,
    log: infrastructure.profileLog,
    listMembers: networkService.listMembers
  })

  // 策略健康检查：探测 M-Policy /health 端点
  interface GlobalWithInternalFetcher {
    __mnet_internal_fetcher?: typeof fetch
  }
  async function checkPolicyHealth(): Promise<{ healthy: boolean }> {
    try {
      const fetcher = (globalThis as GlobalWithInternalFetcher).__mnet_internal_fetcher ?? fetch
      const response = await fetcher(
        `${process.env.MERISTEM_POLICY_URL ?? 'http://127.0.0.1:5101'}/health`
      )
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  }

  const app = createMNetApp({
    readiness,
    createNetwork: networkService.createNetwork,
    listNetworks: networkService.listNetworks,
    joinNetwork: networkService.joinNetwork,
    listMembers: networkService.listMembers,
    executeNoop: agentRuntime.executeNoop,
    controlNode(input) {
      return executeNodeControl(
        {
          store: nodeControlStore,
          policyAuthorize: infrastructure.policyAuthorize,
          events: infrastructure.profileEvents,
          log: infrastructure.profileLog
        },
        input
      )
    },
    profileStore: infrastructure.profileStore,
    dataPlane: infrastructure.dataPlaneStores,
    suspendedOps: infrastructure.suspendedOps,
    approvals: infrastructure.approvalClient,
    events: infrastructure.profileEvents,
    log: infrastructure.profileLog,
    networkUpdater: networkService.networkUpdater,
    policyAuthorize: infrastructure.policyAuthorize,
    profileDisablePolicy: infrastructure.profileDisablePolicy,
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    migrationEngine,
    policyHealthCheck: { checkHealth: checkPolicyHealth },
    ...(agentRuntime.nodeRuntime ? { nodeRuntime: agentRuntime.nodeRuntime } : {})
  })

  const internalServer = serveHttpApp('m-net', app.fetch)
  const joinIngress = await agentRuntime.createJoinIngress()
  const offlineSweep = setInterval(
    () => {
      void agentRuntime.markOfflineNodes(new Date(), heartbeatTimeoutMs())
    },
    Math.max(heartbeatTimeoutMs(), 5000)
  )

  process.on('SIGINT', () => {
    clearInterval(offlineSweep)
    agentRuntime.rejectPendingTasksOnShutdown()
    joinIngress.stop(true)
    void internalServer
      .stop()
      .then(() => infrastructure.client.end())
      .then(() => shutdownTelemetry())
      .then(() => process.exit(0))
  })

  console.log(`m-net internal listening on http://127.0.0.1:${internalServicePorts['m-net']}`)
  console.log(`m-net join ingress listening on https://0.0.0.0:${joinIngressPort()}`)
}
