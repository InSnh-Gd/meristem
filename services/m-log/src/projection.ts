// M-Log Projection Engine：投影平台核心原语
// Phase 10.1 实现 job 管理、cursor 持久化、idempotency、重试/DLQ、健康指标和 backfill。
// 来源：docs/roadmap/PHASE-10.1.md

import { eq, and, asc, sql, gte, lte, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { projectorJobs, projectionCursors, projectionDLQ, timelineLogs, fullLogs, auditLogs } from '../../../packages/db/src/schema.ts'
import type {
  ProjectorJob,
  ProjectorJobStatus,
  ProjectorJobType,
  ProjectionCursor,
  DLQRecord,
  ProjectionHealth,
  BackfillParams,
  BackfillResult,
  TimelineLog,
  FullLog,
  AuditLog
} from '../../../packages/contracts/src/index.ts'

const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] // 1s, 2s, 4s, 8s

// 事实表名到 drizzle 表的映射，用于 backfill 读取
type FactTableName = 'timeline_logs' | 'full_logs' | 'audit_logs'

const factTables = {
  timeline_logs: timelineLogs,
  full_logs: fullLogs,
  audit_logs: auditLogs
} as const

/**
 * 根据索引名反查事实表名
 * 索引命名规则：meristem-{type}-logs-v{N}
 */
function factTableFromIndex(index: string): FactTableName | null {
  if (index.startsWith('meristem-timeline-logs')) return 'timeline_logs'
  if (index.startsWith('meristem-full-logs')) return 'full_logs'
  if (index.startsWith('meristem-audit-logs')) return 'audit_logs'
  return null
}

/**
 * 生成幂等 key：{index}:{factId}:{version}
 * Phase 10.1 §2.2：OpenSearch _id 使用此 key，保证重复投影安全。
 */
function idempotencyKey(index: string, factId: string): string {
  // version 固定为 1，后续可扩展
  return `${index}:${factId}:1`
}

/**
 * 投影引擎构造器。
 * db 用于 job/cursor/dlg 持久化，os 用于 OpenSearch 写入。
 * backfill 读取事实表走 db，写入走 os。
 */
// db 参数接受 Drizzle PostgresJsDatabase，实际运行时由调用方传入具体 schema 的实例。
// 类型兼容性交由调用方保证。
export function createProjectionEngine(
    db: ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>,
  os: {
    indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<boolean>
    searchTimeline?: (q: Record<string, unknown>) => Promise<unknown>
    ensureIndex?(index: string): Promise<boolean>
    ensureAllIndices?: () => Promise<boolean>
    health?: () => Promise<boolean>
  }
) {
  // ---- Job 管理 (§2.1) ----

  async function createJob(
    type: ProjectorJobType,
    index: string,
    startCursor: ProjectionCursor | null,
    endCursor: ProjectionCursor | null,
    batchSize: number
  ): Promise<ProjectorJob> {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db.insert(projectorJobs).values({
      id,
      type,
      index,
      startCursor: startCursor ? { factId: startCursor.factId, timestamp: startCursor.timestamp } : null,
      endCursor: endCursor ? { factId: endCursor.factId, timestamp: endCursor.timestamp } : null,
      batchSize,
      status: 'pending',
      error: null,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    })
    return {
      id,
      type,
      index,
      startCursor,
      endCursor,
      batchSize,
      status: 'pending',
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    }
  }

  async function transitionJob(id: string, status: ProjectorJobStatus, error?: string): Promise<void> {
    const now = new Date()
    const updates: Record<string, unknown> = { status, updatedAt: now }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates['completedAt'] = now
    }
    if (error !== undefined) {
      updates['error'] = error
    }
    await db.update(projectorJobs).set(updates).where(eq(projectorJobs.id, id))
  }

  async function getJob(id: string): Promise<ProjectorJob | null> {
    const rows = await db.select().from(projectorJobs).where(eq(projectorJobs.id, id)).limit(1)
    if (rows.length === 0) return null
    const row = rows[0]
    if (!row) return null
    return mapJobRow(row as Record<string, unknown>)
  }

  // ---- Cursor 管理 (§2.3) ----

  async function getCursor(index: string): Promise<ProjectionCursor | null> {
    const rows = await db.select().from(projectionCursors).where(eq(projectionCursors.index, index)).limit(1)
    if (rows.length === 0) return null
    const row = rows[0]
    if (!row) return null
    return { factId: row.factId, timestamp: row.timestamp.toISOString() }
  }

  async function advanceCursor(index: string, cursor: ProjectionCursor): Promise<void> {
    await db
      .insert(projectionCursors)
      .values({
        index,
        factId: cursor.factId,
        timestamp: new Date(cursor.timestamp),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: projectionCursors.index,
        set: { factId: cursor.factId, timestamp: new Date(cursor.timestamp), updatedAt: new Date() }
      })
  }

  // ---- Retry & DLQ (§2.4) ----

  /**
   * 带指数退避重试的投影写入。
   * 成功返回 true，重试耗尽后入 DLQ 并返回 false。
   */
  async function projectWithRetry(
    jobId: string,
    index: string,
    factId: string,
    doc: Record<string, unknown>,
    retries = 0
  ): Promise<boolean> {
    const key = idempotencyKey(index, factId)
    const success = os.indexDocument ? await os.indexDocument(index, key, doc) : false
    if (success) return true

    if (retries >= MAX_RETRIES) {
      // 进入 DLQ
      const now = new Date()
      await db.insert(projectionDLQ).values({
        id: crypto.randomUUID(),
        jobId,
        factId,
        index,
        error: 'projection_failed_after_retries',
        attemptedAt: [now.toISOString()],
        retries,
        createdAt: now
      })
      return false
    }

    // 指数退避
    const delay = RETRY_BACKOFF_MS[retries] ?? 8000
    await new Promise((resolve) => setTimeout(resolve, delay))
    return projectWithRetry(jobId, index, factId, doc, retries + 1)
  }

  /**
   * DLQ 手动重放：将指定 DLQ 记录重新投影
   */
  async function replayDLQ(dlqId: string): Promise<boolean> {
    const rows = await db.select().from(projectionDLQ).where(eq(projectionDLQ.id, dlqId)).limit(1)
    if (rows.length === 0) return false

    const record = rows[0]
    if (!record) return false
    // 重新读取事实并投影
    const factTable = factTableFromIndex(record.index)
    if (!factTable) return false

    const table = factTables[factTable]
    const factRows = await db.select().from(table).where(eq(table['id' as keyof typeof table] as unknown as SQL<unknown>, record.factId)).limit(1)
    if (factRows.length === 0) return false

    const fact = factRows[0]
    if (!fact) return false
    const doc = mapFactToDoc(record.index, fact as Record<string, unknown>)
    const key = idempotencyKey(record.index, record.factId)
    const success = os.indexDocument ? await os.indexDocument(record.index, key, doc) : false

    if (success) {
      // 从 DLQ 移除
      await db.delete(projectionDLQ).where(eq(projectionDLQ.id, dlqId))
    }
    return success
  }

  /**
   * DLQ 逐条跳过
   */
  async function skipDLQ(dlqId: string): Promise<void> {
    await db.delete(projectionDLQ).where(eq(projectionDLQ.id, dlqId))
  }

  async function listDLQ(index?: string): Promise<DLQRecord[]> {
    const query = index
      ? db.select().from(projectionDLQ).where(eq(projectionDLQ.index, index))
      : db.select().from(projectionDLQ)
    const rows = await query
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      factId: r.factId,
      index: r.index,
      error: r.error,
      attemptedAt: (r.attemptedAt as string[]) ?? [],
      retries: r.retries,
      createdAt: r.createdAt.toISOString()
    }))
  }

  // ---- 健康指标 (§2.6) ----

  async function getProjectionHealth(): Promise<ProjectionHealth[]> {
    const indices = ['meristem-timeline-logs-v0', 'meristem-full-logs-v0', 'meristem-audit-logs-v0']
    const results: ProjectionHealth[] = []

    const osAvailable = os.health ? await os.health().catch(() => false) : true

    for (const index of indices) {
      const cursor = await getCursor(index)
      const dlqCount = (await db.select({ count: sql<number>`count(*)` }).from(projectionDLQ).where(eq(projectionDLQ.index, index)))[0]?.count ?? 0

      let lagSeconds = 0
      let lastProjectedAt: string | null = null
      let pendingCount = 0

      if (cursor) {
        lastProjectedAt = cursor.timestamp
        const factTable = factTableFromIndex(index)
        if (factTable) {
          const table = factTables[factTable]
          // 计算 cursor 之后还有多少事实未投影
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(table)
            .where(gte(table['timestamp' as keyof typeof table] as unknown as SQL<unknown>, new Date(cursor.timestamp)))
          pendingCount = countResult[0]?.count ?? 0

          // 计算延迟（最后投影时间到现在）
          lagSeconds = Math.floor((Date.now() - new Date(cursor.timestamp).getTime()) / 1000)
        }
      }

      let status: 'healthy' | 'degraded' | 'unavailable'
      if (!osAvailable) {
        status = 'unavailable'
      } else if (dlqCount > 0 || lagSeconds > 300) { // 5分钟延迟或存在 DLQ = degraded
        status = 'degraded'
      } else {
        status = 'healthy'
      }

      results.push({ index, lagSeconds, lastProjectedAt, pendingCount, dlqCount, status })
    }

    return results
  }

  // ---- Backfill (§2.5) ----

  /**
   * 执行 backfill：从 PostgreSQL 事实表读取数据，批量投影到 OpenSearch。
   * 支持断点续投（基于 cursor）。
   */
  async function executeBackfill(params: BackfillParams): Promise<BackfillResult> {
    const factTable = factTableFromIndex(params.index)
    if (!factTable) throw new Error(`unknown index: ${params.index}`)

    const job = await createJob('backfill', params.index, params.from, params.to, params.batchSize)
    await transitionJob(job.id, 'running')

    const table = factTables[factTable]
    let processedCount = 0
    let errors = 0
    let currentCursor = params.from ?? await getCursor(params.index) ?? {
      factId: '00000000-0000-0000-0000-000000000000',
      timestamp: '1970-01-01T00:00:00.000Z'
    }

    try {
      while (true) {
        // 读取一批事实
        const conditions: ReturnType<typeof sql>[] = [
          gte(table['timestamp' as keyof typeof table] as unknown as PgColumn, new Date(currentCursor.timestamp))
        ]
        // 排除已等于 cursor.factId 的那条（避免重复）
        if (currentCursor.factId !== '00000000-0000-0000-0000-000000000000') {
          conditions.push(sql`${table['id' as keyof typeof table] as unknown as SQL<unknown>} > ${currentCursor.factId}`)
        }
        if (params.to) {
          conditions.push(lte(table['timestamp' as keyof typeof table] as unknown as PgColumn, new Date(params.to.timestamp)))
        }

        const batch = await db
          .select()
          .from(table)
          .where(and(...conditions))
          .orderBy(asc(table['timestamp' as keyof typeof table] as unknown as PgColumn), asc(table['id' as keyof typeof table] as unknown as SQL<unknown>))
          .limit(params.batchSize)

        if (batch.length === 0) break

        // 逐条投影
        for (const row of batch) {
          const doc = mapFactToDoc(params.index, row as Record<string, unknown>)
          const success = await projectWithRetry(job.id, params.index, (row as Record<string, unknown>).id as string, doc)
          if (success) {
            processedCount++
          } else {
            errors++
          }
        }

        // 更新 cursor 到最后一条
        const last = batch[batch.length - 1]
        if (!last) break
        const lastRec = last as Record<string, unknown>
        currentCursor = {
          factId: lastRec.id as string,
          timestamp: (lastRec.timestamp as Date).toISOString()
        }
        await advanceCursor(params.index, currentCursor)

        if (batch.length < params.batchSize) break // 已读完
      }

      await transitionJob(job.id, 'completed')
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      await transitionJob(job.id, 'failed', errMsg)
      errors++
    }

    return {
      jobId: job.id,
      processedCount,
      errors,
      lastCursor: currentCursor,
      status: errors === 0 ? 'completed' : 'failed'
    }
  }

  return {
    createJob,
    transitionJob,
    getJob,
    getCursor,
    advanceCursor,
    projectWithRetry,
    idempotencyKey,
    replayDLQ,
    skipDLQ,
    listDLQ,
    getProjectionHealth,
    executeBackfill
  }
}

export type ProjectionEngine = ReturnType<typeof createProjectionEngine>

// ---- 内部辅助 ----

/**
 * 将 Drizzle 查询行映射回 ProjectorJob 类型。
 */
function mapJobRow(row: Record<string, unknown>): ProjectorJob {
  return {
    id: row.id as string,
    type: row.type as ProjectorJobType,
    index: row.index as string,
    startCursor: row.startCursor
      ? { factId: String((row.startCursor as Record<string, unknown>).factId ?? ''), timestamp: String((row.startCursor as Record<string, unknown>).timestamp ?? '') }
      : null,
    endCursor: row.endCursor
      ? { factId: String((row.endCursor as Record<string, unknown>).factId ?? ''), timestamp: String((row.endCursor as Record<string, unknown>).timestamp ?? '') }
      : null,
    batchSize: row.batchSize as number,
    status: row.status as ProjectorJobStatus,
    error: row.error as string | null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
    completedAt: row.completedAt ? (row.completedAt as Date).toISOString() : null
  }
}

/**
 * 将 PostgreSQL 事实行映射为 OpenSearch 文档。
 * 根据索引类型返回对应的文档结构。
 */
function mapFactToDoc(index: string, row: { id?: unknown; timestamp?: unknown; summary?: unknown; subject?: unknown; correlation_id?: unknown; level?: unknown; source?: unknown; message?: unknown; trace_id?: unknown; payload?: unknown; actor?: unknown; action?: unknown; resource?: unknown; decision_id?: unknown; result?: unknown }): Record<string, unknown> {
  const timestamp = row.timestamp ? (row.timestamp as Date).toISOString() : new Date().toISOString()

  if (index.startsWith('meristem-timeline-logs')) {
    return {
      timestamp,
      summary: row.summary ?? '',
      subject: row.subject ?? null,
      correlationId: row.correlation_id ?? null
    }
  }

  if (index.startsWith('meristem-full-logs')) {
    return {
      timestamp,
      level: row.level ?? 'info',
      source: row.source ?? '',
      message: row.message ?? '',
      correlationId: row.correlation_id ?? null,
      traceId: row.trace_id ?? null,
      payload: row.payload ?? null
    }
  }

  if (index.startsWith('meristem-audit-logs')) {
    return {
      timestamp,
      actor: row.actor ?? 'system',
      action: row.action ?? '',
      resource: row.resource ?? '',
      decisionId: row.decision_id ?? null,
      result: row.result ?? '',
      correlationId: row.correlation_id ?? null,
      traceId: row.trace_id ?? null,
      payload: row.payload ?? null
    }
  }

  return {}
}
