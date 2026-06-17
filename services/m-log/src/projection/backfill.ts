import { and, asc, gte, lte, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'
import type {
  BackfillParams,
  BackfillResult,
  ProjectionCursor,
  ProjectorJob,
  ProjectorJobStatus
} from '../../../../packages/contracts/src/index.ts'
import { mapFactToDoc } from './document-map.ts'
import { ProjectionUnknownIndexError, ProjectionWorkflowError } from './errors.ts'
import { factTableFromIndex, factTables } from './tables.ts'
import type { ProjectionDatabase } from './types.ts'

type JobStore = {
  createJob(
    type: 'backfill',
    index: string,
    startCursor: ProjectionCursor | null,
    endCursor: ProjectionCursor | null,
    batchSize: number
  ): Promise<ProjectorJob>
  transitionJob(id: string, status: ProjectorJobStatus, error?: string): Promise<void>
}

type CursorStore = {
  getCursor(index: string): Promise<ProjectionCursor | null>
  advanceCursor(index: string, cursor: ProjectionCursor): Promise<void>
}

type RetryProjector = {
  projectWithRetry(
    jobId: string,
    index: string,
    factId: string,
    doc: Record<string, unknown>,
    retries?: number
  ): Promise<boolean>
}

/**
 * Rewrites the version suffix when backfill targets a replacement OpenSearch index.
 */
export function resolveTargetIndex(index: string, targetVersion?: string): string {
  if (!targetVersion) return index
  return index.replace(/-v\d+$/, `-v${targetVersion}`)
}

export function workflowError(operation: string, error: unknown) {
  return new ProjectionWorkflowError({
    operation,
    message: error instanceof Error ? error.message : String(error)
  })
}

export function tryProjection<A>(operation: string, evaluate: () => A | PromiseLike<A>) {
  return Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: error => workflowError(operation, error)
  })
}

/**
 * Creates the Effect workflow for projection backfill execution.
 * 来源：`docs/services/m-log.md` 的投影补偿边界和 `docs/testing/TESTING.md` 的失败模式门禁。
 */
export function createBackfillService(
  db: ProjectionDatabase,
  jobs: JobStore,
  cursors: CursorStore,
  retry: RetryProjector
) {
  const executeBackfillEffect = Effect.fn('MLogProjection.executeBackfill')(function* (
    params: BackfillParams
  ) {
    const targetIndex = resolveTargetIndex(params.index, params.targetVersion)
    const factTable = factTableFromIndex(params.index)
    if (!factTable) {
      return yield* new ProjectionUnknownIndexError({
        index: params.index,
        message: `unknown index: ${params.index}`
      })
    }

    const job = yield* tryProjection('create-backfill-job', () =>
      jobs.createJob('backfill', targetIndex, params.from, params.to, params.batchSize)
    )
    yield* tryProjection('start-backfill-job', () => jobs.transitionJob(job.id, 'running'))

    const table = factTables[factTable]
    let processedCount = 0
    let errors = 0
    let currentCursor = params.from ??
      (yield* tryProjection('read-backfill-cursor', () => cursors.getCursor(targetIndex))) ?? {
        factId: '00000000-0000-0000-0000-000000000000',
        timestamp: '1970-01-01T00:00:00.000Z'
      }

    try {
      while (true) {
        const conditions: ReturnType<typeof sql>[] = [
          gte(
            table['timestamp' as keyof typeof table] as unknown as PgColumn,
            new Date(currentCursor.timestamp)
          )
        ]
        if (currentCursor.factId !== '00000000-0000-0000-0000-000000000000') {
          conditions.push(
            sql`${table['id' as keyof typeof table] as unknown as SQL<unknown>} > ${currentCursor.factId}`
          )
        }
        if (params.to) {
          conditions.push(
            lte(
              table['timestamp' as keyof typeof table] as unknown as PgColumn,
              new Date(params.to.timestamp)
            )
          )
        }

        const batch = yield* tryProjection('read-backfill-batch', () =>
          db
            .select()
            .from(table)
            .where(and(...conditions))
            .orderBy(
              asc(table['timestamp' as keyof typeof table] as unknown as PgColumn),
              asc(table['id' as keyof typeof table] as unknown as SQL<unknown>)
            )
            .limit(params.batchSize)
        )

        if (batch.length === 0) break

        for (const row of batch) {
          const doc = mapFactToDoc(targetIndex, row as Record<string, unknown>)
          const success = yield* tryProjection('project-backfill-row', () =>
            retry.projectWithRetry(
              job.id,
              targetIndex,
              (row as Record<string, unknown>).id as string,
              doc
            )
          )
          if (success) {
            processedCount++
          } else {
            errors++
          }
        }

        const last = batch[batch.length - 1]
        if (!last) break
        const lastRec = last as Record<string, unknown>
        currentCursor = {
          factId: lastRec.id as string,
          timestamp: (lastRec.timestamp as Date).toISOString()
        }
        yield* tryProjection('advance-backfill-cursor', () =>
          cursors.advanceCursor(targetIndex, currentCursor)
        )

        if (batch.length < params.batchSize) break
      }

      yield* tryProjection('complete-backfill-job', () => jobs.transitionJob(job.id, 'completed'))
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      yield* tryProjection('fail-backfill-job', () => jobs.transitionJob(job.id, 'failed', errMsg))
      errors++
    }

    const status: ProjectorJobStatus = errors === 0 ? 'completed' : 'failed'
    return {
      jobId: job.id,
      processedCount,
      errors,
      lastCursor: currentCursor,
      status
    }
  })

  async function executeBackfill(params: BackfillParams): Promise<BackfillResult> {
    return Effect.runPromise(executeBackfillEffect(params))
  }

  return { executeBackfillEffect, executeBackfill }
}
