import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createAgentRuntime } from './agent-runtime.ts'
import { createMNetApp } from './app.ts'
import { createMNetInfrastructure } from './clients.ts'
import { heartbeatTimeoutMs, joinIngressPort } from './config.ts'
import { createDbForcedRelayNodeContext } from './forced-relay-node-context.ts'
import { createWiredMigrationEngine } from './migration-engine-factory.ts'
import { materializeMembers } from './mnet-dataplane-materialize.ts'
import { requireDataPlaneDeps } from './mnet-dataplane-support.ts'
import { createNetworkService } from './network-service.ts'
import { createDbNodeControlStore } from './node-control-store.ts'
import { executeNodeControl } from './node-control-workflow.ts'
import { createOperationalReadModel } from './operational-read-model.ts'
import { createReadinessProbe } from './readiness.ts'
import { networks } from '../../../packages/db/src/schema.ts'
import { eq } from 'drizzle-orm'

/**
 * M-Net 启动装配统一放在这里：入口文件只触发启动，不再直接持有依赖接线与关闭序列。
 */
export async function startMNetService(): Promise<void> {
  const infrastructure = createMNetInfrastructure()
  // 成员变更后的地图重刷新是晚绑定的：dataPlaneDeps 依赖 listMembers，只能在本模块组装完成后回填
  let refreshNetworkMapImpl: ((networkId: string, correlationId: string) => Promise<void>) | null =
    null
  const networkService = createNetworkService({
    db: infrastructure.db,
    profileStore: infrastructure.profileStore,
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    refreshNetworkMap: async (networkId, correlationId) => {
      if (refreshNetworkMapImpl) await refreshNetworkMapImpl(networkId, correlationId)
    }
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
  if (!('kind' in nodeRuntimeDataPlaneDeps)) {
    refreshNetworkMapImpl = async (networkId, correlationId) => {
      const [row] = await infrastructure.db
        .select()
        .from(networks)
        .where(eq(networks.id, networkId))
        .limit(1)
      if (!row) return
      if (row.profileVersion !== 'm-net@0.3.0' && row.profileVersion !== 'm-net-cn@0.3.0') return
      try {
        // 成员移除后重渲染地图，让被移除节点从下一次同步中消失；
        // 渲染失败（如成员已清空）不阻断移除，地图 TTL 与 fail-closed 语义兜底。
        await materializeMembers(
          nodeRuntimeDataPlaneDeps,
          networkId,
          row.profileVersion,
          correlationId
        )
      } catch (error) {
        process.stderr.write(
          `network map refresh failed for ${networkId}: ${error instanceof Error ? error.message : 'unknown error'}\n`
        )
      }
    }
  }
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
  const describeForcedRelayNode = createDbForcedRelayNodeContext(infrastructure.db)
  const migrationEngine = createWiredMigrationEngine({
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    profileStore: infrastructure.profileStore,
    dataPlaneStores: infrastructure.dataPlaneStores,
    log: infrastructure.profileLog,
    listMembers: networkService.listMembers
  })
  const operationalReadModel = createOperationalReadModel({
    profileStore: infrastructure.profileStore,
    listMembers: networkService.listMembers,
    dataPlane: infrastructure.dataPlaneStores,
    events: infrastructure.profileEvents
  })

  // 策略健康检查：探测 M-Policy /health 端点
  interface GlobalWithInternalFetcher {
    __mnet_internal_fetcher?: typeof fetch
  }
  async function checkPolicyHealth(): Promise<{ healthy: boolean }> {
    try {
      const fetcher = (globalThis as GlobalWithInternalFetcher).__mnet_internal_fetcher ?? fetch
      const response = await fetcher(
        `${process.env.MERISTEM_POLICY_URL ?? 'http://127.0.0.1:3101'}/health`
      )
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  }

  const app = createMNetApp({
    db: infrastructure.db,
    readiness,
    createNetwork: networkService.createNetwork,
    listNetworks: networkService.listNetworks,
    joinNetwork: networkService.joinNetwork,
    listMembers: networkService.listMembers,
    deleteNetwork: networkService.deleteNetwork,
    removeMember: networkService.removeMember,
    updateNetworkMetadata: networkService.updateNetworkMetadata,
    executeNoop: agentRuntime.executeNoop,
    describeForcedRelayNode,
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
    getOperationalState: operationalReadModel.getSnapshot,
    ingestOperationalEvent: operationalReadModel.ingestEvent,
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
