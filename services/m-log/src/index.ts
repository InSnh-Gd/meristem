import { createDb } from '../../../packages/db/src/client.ts'
import {
  fetchReadyState,
  internalServicePorts,
  probePostgresReadiness,
  serveHttpApp,
  serviceUrl,
  warnDegradedAndReturn
} from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import {
  createLogger,
  initTelemetry,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'
import { createLogApp } from './app.ts'
import { createLogEventPublisher } from './event-publisher.ts'
import { startEventBusOperationalConsumer } from './eventbus-operational-consumer.ts'
import { createOpenSearchAdapter } from './opensearch.ts'
import { createOpenSearchReadModel } from './opensearch-read-model.ts'
import { createProjectionEngine } from './projection.ts'
import { createLogQueryService } from './query-service.ts'
import { createMLogReadiness } from './readiness.ts'
import { createLogRuntimeState, readLogLevelFromEnv } from './runtime.ts'
import { createLogWriteService } from './write-service.ts'

initTelemetry('m-log')

const logger = createLogger('m-log')

const { db, client } = createDb()
const nc = await connectToNats(process.env.NATS_URL ?? 'ws://localhost:4223')
const publisher = createLogEventPublisher()

// OpenSearch 适配器：可选依赖，不可用时搜索进入 degraded。
const opensearchUsername = process.env.OPENSEARCH_USERNAME
const opensearchPassword = process.env.OPENSEARCH_PASSWORD
const opensearch = createOpenSearchAdapter({
  baseUrl: process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200',
  ...(opensearchUsername ? { username: opensearchUsername } : {}),
  ...(opensearchPassword ? { password: opensearchPassword } : {})
})
const readModel = createOpenSearchReadModel(opensearch)
const initialOpenSearchStatus = await readModel.refresh()

if (initialOpenSearchStatus === 'unavailable') {
  logger.warn('opensearch unavailable, search endpoints will report degraded')
} else if (initialOpenSearchStatus === 'degraded') {
  logger.warn('opensearch cluster is degraded, search remains available')
}

// 投影引擎：依赖 db 和 opensearch 适配器。
// opensearch 不可用时投影引擎标记为不可用，backfill 和健康端点返回 503。
const projectionEngine = createProjectionEngine(db, {
  indexDocument: (index, id, doc) => opensearch.indexDocument(index, id, doc),
  health: async () => readModel.isAvailable(),
  healthStatus: () => readModel.refresh()
})
if (!readModel.isAvailable()) {
  logger.warn('projection engine unavailable (OpenSearch not ready)')
}

const runtimeState = createLogRuntimeState()

const writeService = createLogWriteService(db, opensearch, readModel, publisher)
const queryService = createLogQueryService(db)
startEventBusOperationalConsumer(nc, writeService.writeFull)

const readiness = createMLogReadiness({
  checkPostgres: () =>
    probePostgresReadiness({
      client,
      service: 'm-log',
      readyValue: true,
      fallback: false,
      warn: ({ target, error, message }) => logger.warn({ dependency: target, error }, message)
    }),
  checkNats: () =>
    nc.flush().then(
      () => true,
      error =>
        warnDegradedAndReturn({
          service: 'm-log',
          target: 'nats',
          error,
          context: 'readiness probe degraded',
          fallback: false,
          warn: ({ target, error, message }) => logger.warn({ dependency: target, error }, message)
        })
    ),
  checkEventBus: () => fetchReadyState(`${serviceUrl('m-eventbus')}/ready`),
  refreshOpenSearch: () => readModel.refresh()
})

/**
 * reload 原型当前只重新读取进程内日志级别，不触碰数据库配置版本或其他服务状态。
 */
async function reload(_request: {
  correlationId?: string
  reason?: string
}): Promise<{ serviceId: string; reloadedAt: string }> {
  runtimeState.logLevel = readLogLevelFromEnv()
  runtimeState.lastReloadedAt = new Date().toISOString()
  return {
    serviceId: 'm-log',
    reloadedAt: runtimeState.lastReloadedAt
  }
}

const app = createLogApp({
  readiness,
  writeTimeline: writeService.writeTimeline,
  writeFull: writeService.writeFull,
  writeAudit: writeService.writeAudit,
  writeDeploymentEvidence: writeService.writeDeploymentEvidence,
  listTimeline: queryService.listTimeline,
  listFull: queryService.listFull,
  listAudit: queryService.listAudit,
  reload,
  search: {
    async full(query) {
      return readModel.isAvailable() ? opensearch.searchFull(query) : null
    },
    async timeline(query) {
      return readModel.isAvailable() ? opensearch.searchTimeline(query) : null
    },
    async audit(query) {
      return readModel.isAvailable() ? opensearch.searchAudit(query) : null
    },
    isAvailable() {
      return readModel.isAvailable()
    },
    status() {
      return readModel.status()
    }
  },
  // 投影 deps
  projection: {
    getProjectionHealth: () => projectionEngine.getProjectionHealth(),
    executeBackfill: params => projectionEngine.executeBackfill(params),
    listDLQ: index => projectionEngine.listDLQ(index),
    replayDLQ: dlqId => projectionEngine.replayDLQ(dlqId),
    skipDLQ: dlqId => projectionEngine.skipDLQ(dlqId),
    isAvailable() {
      return readModel.isAvailable()
    }
  }
})

const server = serveHttpApp('m-log', app.fetch)

process.on('SIGINT', () => {
  void nc
    .drain()
    .then(() => server.stop())
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

logger.info({ url: `http://127.0.0.1:${internalServicePorts['m-log']}` }, 'm-log listening')
