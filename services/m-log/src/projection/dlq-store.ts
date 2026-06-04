import { eq, type SQL } from 'drizzle-orm'
import { projectionDLQ } from '../../../../packages/db/src/schema.ts'
import type { DLQRecord } from '../../../../packages/contracts/src/index.ts'
import { mapFactToDoc } from './document-map.ts'
import { idempotencyKey } from './retry.ts'
import { factTableFromIndex, factTables } from './tables.ts'
import type { ProjectionDatabase, ProjectionOpenSearch } from './types.ts'

/**
 * Creates DLQ list/replay/skip operations behind M-Log projection internals.
 */
export function createDlqStore(db: ProjectionDatabase, os: ProjectionOpenSearch) {
  async function replayDLQ(dlqId: string): Promise<boolean> {
    const rows = await db.select().from(projectionDLQ).where(eq(projectionDLQ.id, dlqId)).limit(1)
    if (rows.length === 0) return false

    const record = rows[0]
    if (!record) return false
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
      await db.delete(projectionDLQ).where(eq(projectionDLQ.id, dlqId))
    }
    return success
  }

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

  return { replayDLQ, skipDLQ, listDLQ }
}

