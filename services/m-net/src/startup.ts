import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../../packages/config/src/index.ts'
import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createAgentRuntime } from './agent-runtime.ts'
import { createMNetApp } from './app.ts'
import { createMNetInfrastructure } from './clients.ts'
import { heartbeatTimeoutMs, joinIngressPort } from './config.ts'
import { createWiredMigrationEngine } from './migration-engine-factory.ts'
import { requireDataPlaneDeps } from './mnet-dataplane-support.ts'
import { materializeMembers } from './mnet-dataplane-materialize.ts'
import {
  createNetworkService,
  createNetworkUpdater,
  listNetworkMembers
} from './network-service.ts'
import { createNetworkMapRefresher } from './network-map-refresh.ts'
import { createDbNodeControlStore } from './node-control-store.ts'
import { executeNodeControl } from './node-control-workflow.ts'
import { createOperationalReadModel } from './operational-read-model.ts'
import { createReadinessProbe } from './readiness.ts'
import { createDbForcedRelayNodeContext } from './forced-relay-node-context.ts'
import { createClosedLoopProduction } from './closed-loop-production.ts'

/**
 * M-Net 启动装配统一放在这里：入口文件只触发启动，不再直接持有依赖接线与关闭序列。
 */
export async function startMNetService(): Promise<void> {
  function requiredJwtSecret(): string {
    const secret = process.env.MERISTEM_JWT_SECRET
    if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
    return secret
  }

  const runtimeConfig = await loadRuntimeDeploymentConfigOrThrow()
  const authVerifier = createSharedAuthVerifier(
    runtimeConfig.auth.provider === 'local-dev'
      ? { auth: runtimeConfig.auth, localDev: { jwtSecret: requiredJwtSecret() } }
      : { auth: runtimeConfig.auth }
  )
  const infrastructure = createMNetInfrastructure()
  // db-only 端口先构造：数据面依赖与 map refresher 只需要 listMembers/networkUpdater，
  // 不必等待 network service 实例，从而消除 refreshNetworkMap 的构造环。
  const listMembers = (input: { networkId: string }) => listNetworkMembers(infrastructure.db, input)
  const networkUpdater = createNetworkUpdater(infrastructure.db)
  const nodeRuntimeDataPlaneDeps = requireDataPlaneDeps({
    profileStore: infrastructure.profileStore,
    policyAuthorize: infrastructure.policyAuthorize,
    listMembers,
    dataPlane: infrastructure.dataPlaneStores,
    events: infrastructure.profileEvents,
    log: infrastructure.profileLog,
    networkUpdater
  })
  const networkService = createNetworkService({
    db: infrastructure.db,
    profileStore: infrastructure.profileStore,
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    // 成员变更后重新物化并发布签名 map；仅当数据面依赖齐备时注入。
    ...('kind' in nodeRuntimeDataPlaneDeps
      ? {}
      : {
          refreshNetworkMap: createNetworkMapRefresher(nodeRuntimeDataPlaneDeps, materializeMembers)
        })
  })
  const readiness = createReadinessProbe(infrastructure.client, infrastructure.checkStoreHealth)
  const nodeControlStore = createDbNodeControlStore(infrastructure.db)
  const describeForcedRelayNode = createDbForcedRelayNodeContext(infrastructure.db)
  const migrationEngine = createWiredMigrationEngine({
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    profileStore: infrastructure.profileStore,
    dataPlaneStores: infrastructure.dataPlaneStores,
    log: infrastructure.profileLog,
    listMembers
  })
  const operationalReadModel = createOperationalReadModel({
    profileStore: infrastructure.profileStore,
    listMembers,
    dataPlane: infrastructure.dataPlaneStores,
    events: infrastructure.profileEvents
  })
  const closedLoop = createClosedLoopProduction({
    infrastructure,
    runtimeConfig,
    network: {
      listNetworks: networkService.listNetworks,
      listMembers
    },
    migrationEngine
  })
  await closedLoop.recoverCredentialOperations()
  const agentRuntime = createAgentRuntime({
    db: infrastructure.db,
    publishEvent: infrastructure.publishEvent,
    writeTimeline: infrastructure.writeTimeline,
    writeFull: infrastructure.writeFull,
    writeAudit: infrastructure.writeAudit,
    dataPlaneDeps: 'kind' in nodeRuntimeDataPlaneDeps ? null : nodeRuntimeDataPlaneDeps,
    async reportRuntimeStatus(input) {
      await operationalReadModel.ingestRuntimeStatus(input)
      await closedLoop.ingestNodeRuntimeStatus(input)
    },
    reportTunnelHealth(input) {
      return closedLoop.service.recordTunnelHealth({
        networkId: input.networkId,
        health: {
          ...input.health,
          nodeId: input.nodeId,
          stateSource: 'node-runtime-report'
        }
      })
    }
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
    db: infrastructure.db,
    readiness,
    createNetwork: networkService.createNetwork,
    listNetworks: networkService.listNetworks,
    joinNetwork: networkService.joinNetwork,
    listMembers: networkService.listMembers,
    // 网络生命周期变更端口：此前未注入，导致内部路由恒返 503 feature.unavailable。
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
    ...(agentRuntime.nodeRuntime ? { nodeRuntime: agentRuntime.nodeRuntime } : {}),
    auth: {
      async verify(token: string) {
        const result = await authVerifier.verify(token)
        if (!result.ok) return { ok: false as const, code: result.code, message: result.message }
        return { ok: true as const, actor: result.session.actor.id }
      }
    },
    closedLoop: closedLoop.service
  })

  const internalServer = serveHttpApp('m-net', app.fetch)
  const joinIngress = await agentRuntime.createJoinIngress()
  const offlineSweep = setInterval(
    () => {
      void agentRuntime.markOfflineNodes(new Date(), heartbeatTimeoutMs())
    },
    Math.max(heartbeatTimeoutMs(), 5000)
  )
  const breakGlassExpirySweep = setInterval(() => {
    void closedLoop.enforceExpiry().catch(error => {
      console.warn(
        `m-net: break-glass expiry sweep degraded - ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }, 60_000)
  const closedLoopPublicationSweep = setInterval(() => {
    void closedLoop.flushPendingEvents().catch(error => {
      console.warn(
        `m-net: closed-loop publication sweep degraded - ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }, 30_000)
  const credentialRecoverySweep = setInterval(() => {
    void closedLoop.recoverCredentialOperations().catch(error => {
      console.warn(
        `m-net: credential recovery sweep degraded - ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }, 30_000)

  process.on('SIGINT', () => {
    clearInterval(offlineSweep)
    clearInterval(breakGlassExpirySweep)
    clearInterval(closedLoopPublicationSweep)
    clearInterval(credentialRecoverySweep)
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
