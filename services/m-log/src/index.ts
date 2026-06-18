import { createDb } from '../../../packages/db/src/client.ts'
import {
  fetchReadyState,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import {
  initTelemetry,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'
import { createLogApp } from './app.ts'
import { startEventBusOperationalConsumer } from './eventbus-operational-consumer.ts'
import { createLogEventPublisher } from './event-publisher.ts'
import { createOpenSearchAdapter } from './opensearch.ts'
import { createProjectionEngine } from './projection.ts'
import { createLogQueryService } from './query-service.ts'
import { createLogRuntimeState, readLogLevelFromEnv } from './runtime.ts'
import { createLogWriteService } from './write-service.ts'

initTelemetry('m-log')

const { db, client } = createDb()
const nc = await connectToNats(process.env.NATS_URL ?? 'ws://localhost:4223')
const publisher = createLogEventPublisher()

// OpenSearch 适配器：可选依赖，不可用时搜索进入 degraded。
const opensearchUrl = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200'
const opensearch = createOpenSearchAdapter(opensearchUrl)
const opensearchAvailable: boolean = await opensearch.health().then(async ok => {
  if (!ok) return false
  return opensearch.ensureAllIndices()
})

if (!opensearchAvailable) {
  console.warn('m-log: OpenSearch unavailable, search endpoints will report degraded')
}

// 投影引擎：依赖 db 和 opensearch 适配器。
// opensearch 不可用时投影引擎标记为不可用，backfill 和健康端点返回 503。
const projectionEngine = createProjectionEngine(db, {
  indexDocument: (index, id, doc) => opensearch.indexDocument(index, id, doc),
  health: () => opensearch.health()
})
const projectionAvailable: boolean = opensearchAvailable
if (!projectionAvailable) {
  console.warn('m-log: projection engine unavailable (OpenSearch not ready)')
}

const runtimeState = createLogRuntimeState()

/**
 * readiness 探针把依赖故障收敛为 false，但仍然要输出诊断信息给运维面。
 */
function warnReadinessFallback(dependency: string, error: unknown): false {
  console.warn(
    `m-log: ${dependency} readiness probe degraded - ${error instanceof Error ? error.message : String(error)}`
  )
  return false
}

const writeService = createLogWriteService(db, opensearch, opensearchAvailable, publisher)
const queryService = createLogQueryService(db)
startEventBusOperationalConsumer(nc, writeService.writeFull)

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
  async readiness() {
    const postgresReady = await client`select 1`
      .then(() => true)
      .catch(error => warnReadinessFallback('postgres', error))
    const natsReady = await nc
      .flush()
      .then(() => true)
      .catch(error => warnReadinessFallback('nats', error))
    const eventBusReady = await fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    return {
      ready: postgresReady && natsReady && eventBusReady,
      opensearch: opensearchAvailable ? ('ready' as const) : ('unavailable' as const)
    }
  },
  writeTimeline: writeService.writeTimeline,
  writeFull: writeService.writeFull,
  writeAudit: writeService.writeAudit,
  listTimeline: queryService.listTimeline,
  listFull: queryService.listFull,
  listAudit: queryService.listAudit,
  reload,
  search: {
    async full(query) {
      return opensearchAvailable ? opensearch.searchFull(query) : null
    },
    async timeline(query) {
      return opensearchAvailable ? opensearch.searchTimeline(query) : null
    },
    async audit(query) {
      return opensearchAvailable ? opensearch.searchAudit(query) : null
    },
    isAvailable() {
      return opensearchAvailable
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
      return projectionAvailable
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

console.log(`m-log listening on http://127.0.0.1:${internalServicePorts['m-log']}`)
