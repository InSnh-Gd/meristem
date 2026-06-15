import { projectionDLQ } from '../../../../packages/db/src/schema.ts'
import type { ProjectionDatabase, ProjectionOpenSearch } from './types.ts'

const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] // 1s, 2s, 4s, 8s

/**
 * Builds the OpenSearch document id used for idempotent projection writes.
 */
export function idempotencyKey(index: string, factId: string): string {
  return `${index}:${factId}:1`
}

/**
 * Creates retry behavior for projection writes and DLQ persistence on exhaustion.
 * 来源：`docs/services/m-log.md` 的投影重试边界和 `docs/testing/TESTING.md` 的失败模式门禁。
 */
export function createRetryProjector(db: ProjectionDatabase, os: ProjectionOpenSearch) {
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

    const delay = RETRY_BACKOFF_MS[retries] ?? 8000
    await new Promise(resolve => setTimeout(resolve, delay))
    return projectWithRetry(jobId, index, factId, doc, retries + 1)
  }

  return { projectWithRetry }
}
