import { edenTreaty } from '@elysiajs/eden'
import { desc } from 'drizzle-orm'
import { createDb } from '../../../packages/db/src/client.ts'
import { auditLogs, fullLogs, timelineLogs } from '../../../packages/db/src/schema.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  createInternalFetcher,
  fetchReadyState,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import type { ActorId, AuditLog, FullLog, TimelineLog } from '../../../packages/contracts/src/index.ts'
import { currentTraceId, initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/app.ts'
import { createLogApp } from './app.ts'
import { createOpenSearchAdapter } from './opensearch.ts'

initTelemetry('m-log')

const { db, client } = createDb()
const nc = await connectToNats(process.env.NATS_URL ?? 'ws://localhost:4223')
// M-Log 通过内部 EventBus 发布审计事件，不直接绕过 envelope 校验写裸 NATS 消息。
const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), {
  fetcher: createInternalFetcher()
})

// Phase 10 OpenSearch 适配器：可选依赖，不可用时搜索进入 degraded。
const opensearchUrl = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200'
const opensearch = createOpenSearchAdapter(opensearchUrl)
const opensearchAvailable: boolean = await opensearch.health().then(async (ok) => {
  if (!ok) return false
  return opensearch.ensureAllIndices()
})

if (!opensearchAvailable) {
  console.warn('m-log: OpenSearch unavailable, search endpoints will report degraded')
}

type TimelineWriteRequest = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteRequest = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteRequest = Omit<AuditLog, 'id' | 'timestamp'>
type LogLevel = FullLog['level']

const allowedLogLevels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
const runtimeState: { logLevel: LogLevel; lastReloadedAt?: string } = {
  logLevel: readLogLevelFromEnv()
}

/**
 * 环境变量里的日志级别必须收敛到固定集合，reload 才能保持可预测行为。
 */
function readLogLevelFromEnv(): LogLevel {
  const level = process.env.MERISTEM_LOG_LEVEL ?? 'info'
  if (allowedLogLevels.includes(level as LogLevel)) return level as LogLevel
  throw new Error(`invalid MERISTEM_LOG_LEVEL: ${level}`)
}

/**
 * 三类写入函数统一在这里创建 PostgreSQL 事实，并在写入成功后 best-effort 投影到 OpenSearch。
 * OpenSearch 投影失败不阻塞 PostgreSQL 写，也不回滚已写事实。
 */
async function writeTimeline(request: TimelineWriteRequest): Promise<TimelineLog> {
  const entry: TimelineLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(timelineLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    summary: entry.summary,
    subject: entry.subject,
    correlationId: entry.correlationId
  })

  // Phase 10 best-effort OpenSearch 投影
  if (opensearchAvailable) {
    opensearch.indexTimelineLog(entry).catch(() => {})
  }

  return entry
}

async function writeFull(request: FullWriteRequest): Promise<FullLog> {
  const entry: FullLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(fullLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    level: entry.level,
    source: entry.source,
    message: entry.message,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    payload: entry.payload
  })

  if (opensearchAvailable) {
    opensearch.indexFullLog(entry).catch(() => {})
  }

  return entry
}

async function writeAudit(request: AuditWriteRequest): Promise<AuditLog> {
  const entry: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(auditLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    decisionId: entry.decisionId,
    result: entry.result,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    payload: entry.payload
  })

  if (opensearchAvailable) {
    opensearch.indexAuditLog(entry).catch(() => {})
  }

  const traceId = entry.traceId ?? currentTraceId()
  const event = createEventEnvelope({
    type: 'audit.entry.created',
    source: 'm-log',
    payload: {
      auditId: entry.id,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      decisionId: entry.decisionId
    },
    ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
    ...(traceId ? { traceId } : {})
  })
  const publish = await eventBus.internal.v0.publish.post({
    subject: 'audit.entry.created.v0',
    event
  })
  if (publish.error || !publish.data) {
    throw new Error('failed to publish audit.entry.created.v0')
  }

  return entry
}

/**
 * reload 原型当前只重新读取进程内日志级别，不触碰数据库配置版本或其他服务状态。
 */
async function reload(_request: { correlationId?: string; reason?: string }): Promise<{ serviceId: string; reloadedAt: string }> {
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
      .catch(() => false)
    const natsReady = await nc.flush()
      .then(() => true)
      .catch(() => false)
    const eventBusReady = await fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    return { ready: postgresReady && natsReady && eventBusReady, opensearch: opensearchAvailable ? ('ready' as const) : ('unavailable' as const) }
  },
  writeTimeline,
  writeFull,
  writeAudit,
  async listTimeline(limit) {
    const rows = await db.select().from(timelineLogs).orderBy(desc(timelineLogs.timestamp)).limit(limit ?? 50)
    return rows.map((row) => {
      const entry: TimelineLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        summary: row.summary
      }
      if (row.subject) entry.subject = row.subject
      if (row.correlationId) entry.correlationId = row.correlationId
      return entry
    })
  },
  async listFull(limit) {
    const rows = await db.select().from(fullLogs).orderBy(desc(fullLogs.timestamp)).limit(limit ?? 50)
    return rows.map((row) => {
      const entry: FullLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        level: row.level as FullLog['level'],
        source: row.source,
        message: row.message
      }
      if (row.correlationId) entry.correlationId = row.correlationId
      if (row.traceId) entry.traceId = row.traceId
      if (row.payload) entry.payload = row.payload
      return entry
    })
  },
  async listAudit(limit) {
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(limit ?? 50)
    return rows.map((row) => {
      const entry: AuditLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        actor: row.actor as ActorId | 'system',
        action: row.action,
        resource: row.resource,
        result: row.result
      }
      if (row.decisionId) entry.decisionId = row.decisionId
      if (row.correlationId) entry.correlationId = row.correlationId
      if (row.traceId) entry.traceId = row.traceId
      if (row.payload) entry.payload = row.payload
      return entry
    })
  },
  reload,
  search: {
    async full(query) { return opensearchAvailable ? opensearch.searchFull(query) : null },
    async timeline(query) { return opensearchAvailable ? opensearch.searchTimeline(query) : null },
    async audit(query) { return opensearchAvailable ? opensearch.searchAudit(query) : null },
    isAvailable() { return opensearchAvailable }
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
