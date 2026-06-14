// M-Log Projection Engine：投影平台核心 facade，实现 job、cursor、retry/DLQ、health 和 backfill。
// A-004 将内部模块拆深。

import { createBackfillService } from './backfill.ts'
import { createCursorStore } from './cursor-store.ts'
import { createDlqStore } from './dlq-store.ts'
import { createProjectionHealthService } from './health.ts'
import { createJobStore } from './job-store.ts'
import { createRetryProjector, idempotencyKey } from './retry.ts'
import type { ProjectionDatabase, ProjectionOpenSearch } from './types.ts'

/**
 * Constructs the M-Log-owned projection engine facade.
 * Core and M-Log routes depend on this facade, not job/cursor/DLQ internals.
 */
export function createProjectionEngine(db: ProjectionDatabase, os: ProjectionOpenSearch) {
  const jobs = createJobStore(db)
  const cursors = createCursorStore(db)
  const retry = createRetryProjector(db, os)
  const dlq = createDlqStore(db, os)
  const health = createProjectionHealthService(db, os, cursors)
  const backfill = createBackfillService(db, jobs, cursors, retry)

  return {
    createJob: jobs.createJob,
    transitionJob: jobs.transitionJob,
    getJob: jobs.getJob,
    getCursor: cursors.getCursor,
    advanceCursor: cursors.advanceCursor,
    projectWithRetry: retry.projectWithRetry,
    idempotencyKey,
    replayDLQ: dlq.replayDLQ,
    skipDLQ: dlq.skipDLQ,
    listDLQ: dlq.listDLQ,
    getProjectionHealth: health.getProjectionHealth,
    executeBackfillEffect: backfill.executeBackfillEffect,
    executeBackfill: backfill.executeBackfill
  }
}

export type ProjectionEngine = ReturnType<typeof createProjectionEngine>
