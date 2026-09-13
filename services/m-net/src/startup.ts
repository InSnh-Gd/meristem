import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../../packages/config/src/index.ts'
import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createAgentRuntime } from './agent/agent-runtime.ts'
import { createDbNodeControlStore } from './agent/node-control-store.ts'
import { executeNodeControl } from './agent/node-control-workflow.ts'
import { createMNetApp } from './app.ts'
import { createMNetInfrastructure } from './clients.ts'
import { createClosedLoopProduction } from './closed-loop/closed-loop-production.ts'
import { heartbeatTimeoutMs, joinIngressPort } from './config.ts'
import { materializeMembers } from './data-plane/mnet-dataplane-materialize.ts'
import { requireDataPlaneDeps } from './data-plane/mnet-dataplane-support.ts'
import { createNetworkMapRefresher } from './data-plane/network-map-refresh.ts'
import { createDbForcedRelayNodeContext } from './forced-relay/forced-relay-node-context.ts'
import { createWiredMigrationEngine } from './migration/migration-engine-factory.ts'
import {
  createNetworkService,
  createNetworkUpdater,
  listNetworkMembers
} from './network-service.ts'
import {
  createPgMNetNetworkEventOutboxStore,
  dispatchPendingNetworkEvents
} from './data-plane/network-event-outbox.ts'
import { createOperationalReadModel } from './operational-read-model.ts'
import { createReadinessProbe } from './readiness.ts'

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
  // 网络生命周期事件 outbox：变更与 intent 已同事务提交，这里负责 at-least-once 投递与补发。
  // 网络权威状态始终在 PostgreSQL（createDb 恒为 pg client），因此始终用 pg outbox；
  // 内存实现仅供单测，若在此使用会与事务内写入的 intent 脱节、导致 sweep 永远看不到 pending。
  const networkEventOutbox = createPgMNetNetworkEventOutboxStore(infrastructure.db)
  const networkService = createNetworkService({
    db: infrastructure.db,
    profileStore: infrastructure.profileStore,
    globalDefaultsStore: infrastructure.globalDefaultsStore,
    // 变更事务提交后只内联投递本次写入的 intent；sweep 仍是失败重试兜底。
    dispatchEvents: async intentId => {
      await dispatchPendingNetworkEvents(
        {
          store: networkEventOutbox,
          events: infrastructure.profileEvents
        },
        intentId
      )
    },
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
  // 网络生命周期事件补发：变更事务只写 pending intent，投递失败在此重试（at-least-once）。
  const networkEventPublicationSweep = setInterval(() => {
    void dispatchPendingNetworkEvents({
      store: networkEventOutbox,
      events: infrastructure.profileEvents
    }).catch((error: unknown) => {
      console.warn(
        `m-net: network event publication sweep degraded - ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }, 30_000)

  process.on('SIGINT', () => {
    clearInterval(offlineSweep)
    clearInterval(breakGlassExpirySweep)
    clearInterval(closedLoopPublicationSweep)
    clearInterval(credentialRecoverySweep)
    clearInterval(networkEventPublicationSweep)
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
