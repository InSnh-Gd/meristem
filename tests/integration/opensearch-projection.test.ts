import { beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Exit } from 'effect'
import type { BackfillParams } from '../../packages/contracts/src/index.ts'
import {
  auditLogs,
  fullLogs,
  projectionCursors,
  projectionDLQ,
  projectorJobs,
  timelineLogs
} from '../../packages/db/src/schema.ts'
import { ProjectionUnknownIndexError } from '../../services/m-log/src/projection/errors.ts'
import { createProjectionEngine } from '../../services/m-log/src/projection.ts'

function createMockDb() {
  const tables = [
    projectorJobs,
    projectionCursors,
    projectionDLQ,
    timelineLogs,
    fullLogs,
    auditLogs
  ]

  const storeMap = new WeakMap<object, Array<Record<string, unknown>>>()
  for (const t of tables) storeMap.set(t as object, [])

  function getStore(table: object) {
    const s = storeMap.get(table)
    if (!s) throw new Error('unknown table in mock db')
    return s
  }

  function extractParamValues(cond: unknown): unknown[] {
    const c = cond as { queryChunks?: unknown[] }
    if (!c?.queryChunks) return []
    const vals: unknown[] = []
    for (const ch of c.queryChunks) {
      if (ch && typeof ch === 'object' && 'value' in (ch as object)) {
        vals.push((ch as { value: unknown }).value)
      }
    }
    return vals
  }

  function matchById(rows: Array<Record<string, unknown>>, cond: unknown) {
    const vals = extractParamValues(cond)
    return rows.filter(r => vals.some(v => r.id === v))
  }

  return {
    insert(table: object) {
      const store = getStore(table)
      return {
        values: (row: Record<string, unknown>) => {
          store.push({ ...row })
          const chain = {
            onConflictDoUpdate: (_opts: { target: unknown; set: Record<string, unknown> }) => {
              // naive upsert: if a row with same index exists, update it; otherwise keep inserted
              // This is used only by advanceCursor on projection_cursors where index is unique.
              const targetCol = 'index' // heuristic for projection_cursors
              const existingIdx = store.findIndex(
                (r, i) => i !== store.length - 1 && r[targetCol] === row[targetCol]
              )
              if (existingIdx !== -1 && _opts.set) {
                const existing = store[existingIdx]
                if (existing) Object.assign(existing, _opts.set)
                store.pop() // remove the just-pushed row since we updated existing
              }
              return Promise.resolve() as Promise<void>
            }
          }
          return chain
        }
      }
    },
    select() {
      return {
        from(table: object) {
          const rows = [...getStore(table)]
          return {
            where(_cond: unknown) {
              return {
                limit(n: number) {
                  return rows.slice(0, n)
                },
                orderBy(..._args: unknown[]) {
                  return {
                    limit(n: number) {
                      return rows.slice(0, n)
                    }
                  }
                }
              }
            },
            limit(n: number) {
              return rows.slice(0, n)
            },
            orderBy(..._args: unknown[]) {
              return {
                limit(n: number) {
                  return rows.slice(0, n)
                }
              }
            }
          }
        }
      }
    },
    update(table: object) {
      const store = getStore(table)
      return {
        set: (updates: Record<string, unknown>) => ({
          where(cond: unknown) {
            const matches = matchById(store, cond)
            for (const m of matches) {
              if (updates) Object.assign(m, updates)
            }
            return Promise.resolve() as Promise<void>
          }
        })
      }
    },
    delete(table: object) {
      const store = getStore(table)
      return {
        where(cond: unknown) {
          const toRemove = new Set(matchById(store, cond))
          for (let i = store.length - 1; i >= 0; i--) {
            const row = store[i]
            if (row && toRemove.has(row)) store.splice(i, 1)
          }
          return Promise.resolve() as Promise<void>
        }
      }
    },
    getStore(table: object) {
      const s = storeMap.get(table)
      if (!s) throw new Error('unknown table in mock db')
      return s
    },
    storeMap,
    _reset() {
      for (const t of tables) storeMap.set(t as object, [])
    }
  }
}

type MockDb = ReturnType<typeof createMockDb>

function requirePresent<T>(value: T | null | undefined, label: string): T {
  expect(value).toBeDefined()
  if (value === null || value === undefined) throw new Error(`${label} must be present`)
  return value
}

function createMockOs() {
  const docs: Array<{ index: string; id: string; doc: Record<string, unknown> }> = []
  let healthy = true
  return {
    async indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<boolean> {
      docs.push({ index, id, doc })
      return true
    },
    async health(): Promise<boolean> {
      return healthy
    },
    docs,
    setHealthy(v: boolean) {
      healthy = v
    }
  }
}

describe('Projection engine', () => {
  let db: MockDb
  let os: ReturnType<typeof createMockOs>
  let engine: ReturnType<typeof createProjectionEngine>

  beforeEach(() => {
    db = createMockDb()
    os = createMockOs()
    const projectionDb = db as unknown as Parameters<typeof createProjectionEngine>[0]
    engine = createProjectionEngine(projectionDb, os)
  })

  it('creates a backfill job and transitions it to running then completed', async () => {
    db.getStore(timelineLogs).push({
      id: 'fact-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      summary: 'hello',
      subject: 'world',
      correlation_id: null
    })

    const result = await engine.executeBackfill({
      index: 'meristem-timeline-logs-v0',
      from: null,
      to: null,
      batchSize: 10
    } as BackfillParams)

    expect(result.status).toBe('completed')
    expect(result.processedCount).toBe(1)
    expect(result.errors).toBe(0)
    expect(os.docs.length).toBe(1)
    const indexedDoc = requirePresent(os.docs[0], 'indexed document')
    expect(indexedDoc.index).toBe('meristem-timeline-logs-v0')

    const jobRows = db.getStore(projectorJobs)
    expect(jobRows.length).toBe(1)
    const job = requirePresent(jobRows[0], 'projector job')
    expect(job.status).toBe('completed')
  })

  it('idempotencyKey format is {index}:{factId}:1', () => {
    const key = engine.idempotencyKey('meristem-timeline-logs-v0', 'abc-123')
    expect(key).toBe('meristem-timeline-logs-v0:abc-123:1')
  })

  it('projectWithRetry succeeds on first attempt', async () => {
    const ok = await engine.projectWithRetry('job-1', 'meristem-timeline-logs-v0', 'f1', {
      summary: 's'
    })
    expect(ok).toBe(true)
    expect(os.docs.length).toBe(1)
  })

  it('projectWithRetry enters DLQ after max retries', async () => {
    os.indexDocument = async () => false
    const originalSetTimeout = globalThis.setTimeout
    type SetTimeoutParameters = Parameters<typeof globalThis.setTimeout>
    type SetTimeoutHandler = SetTimeoutParameters[0]
    type SetTimeoutDelay = SetTimeoutParameters[1]
    type SetTimeoutExtraArgs = SetTimeoutParameters extends [unknown, unknown?, ...infer Rest]
      ? Rest
      : never
    const immediateSetTimeout = Object.assign(
      (handler: SetTimeoutHandler, _timeout?: SetTimeoutDelay, ...args: SetTimeoutExtraArgs) => {
        if (typeof handler === 'function') {
          handler(...args)
        } else {
          new Function(handler)()
        }
        return originalSetTimeout(() => undefined, 0)
      },
      { __promisify__: originalSetTimeout.__promisify__ }
    ) as typeof globalThis.setTimeout
    globalThis.setTimeout = immediateSetTimeout
    try {
      const ok = await engine.projectWithRetry('job-1', 'meristem-timeline-logs-v0', 'f1', {
        summary: 's'
      })
      expect(ok).toBe(false)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
    const dlq = db.getStore(projectionDLQ)
    expect(dlq.length).toBe(1)
    const dlqRecord = requirePresent(dlq[0], 'projection dlq record')
    expect(dlqRecord.factId).toBe('f1')
    expect(dlqRecord.index).toBe('meristem-timeline-logs-v0')
  })

  it('replayDLQ removes record on success', async () => {
    db.getStore(projectionDLQ).push({
      id: 'dlq-1',
      jobId: 'job-1',
      factId: 'f1',
      index: 'meristem-timeline-logs-v0',
      error: 'fail',
      attemptedAt: ['2024-01-01T00:00:00.000Z'],
      retries: 3,
      createdAt: new Date()
    })
    db.getStore(timelineLogs).push({
      id: 'f1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      summary: 'hello',
      subject: 'world',
      correlation_id: null
    })

    const ok = await engine.replayDLQ('dlq-1')
    expect(ok).toBe(true)
    expect(db.getStore(projectionDLQ).length).toBe(0)
    expect(os.docs.length).toBe(1)
  })

  it('skipDLQ removes record', async () => {
    db.getStore(projectionDLQ).push({
      id: 'dlq-2',
      jobId: 'job-1',
      factId: 'f2',
      index: 'meristem-timeline-logs-v0',
      error: 'fail',
      attemptedAt: ['2024-01-01T00:00:00.000Z'],
      retries: 3,
      createdAt: new Date()
    })
    await engine.skipDLQ('dlq-2')
    expect(db.getStore(projectionDLQ).length).toBe(0)
  })

  it('getProjectionHealth returns healthy when no lag and no DLQ', async () => {
    db.getStore(projectionCursors).push({
      index: 'meristem-timeline-logs-v0',
      factId: 'f1',
      timestamp: new Date(),
      updatedAt: new Date()
    })

    const health = await engine.getProjectionHealth()
    const healthRow = requirePresent(
      health.find(x => x.index === 'meristem-timeline-logs-v0'),
      'projection health row'
    )
    expect(healthRow.status).toBe('healthy')
    expect(healthRow.dlqCount).toBe(0)
    expect(healthRow.pendingCount).toBe(0)
  })

  it('exposes typed Effect errors for invalid backfill indices', async () => {
    const exit = await Effect.runPromiseExit(
      engine.executeBackfillEffect({
        index: 'meristem-unknown-logs-v0',
        from: null,
        to: null,
        batchSize: 10
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause._tag === 'Fail' ? exit.cause.error : null
      expect(error).toBeInstanceOf(ProjectionUnknownIndexError)
      expect(error?._tag).toBe('ProjectionUnknownIndexError')
    }
  })
})
