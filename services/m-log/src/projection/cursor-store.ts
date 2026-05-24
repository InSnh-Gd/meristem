import { eq } from 'drizzle-orm'
import { projectionCursors } from '../../../../packages/db/src/schema.ts'
import type { ProjectionCursor } from '../../../../packages/contracts/src/index.ts'
import type { ProjectionDatabase } from './types.ts'

/**
 * Creates the cursor-store facade for projection checkpoint persistence.
 * Source: docs/roadmap/PHASE-10.1.md §2.3.
 */
export function createCursorStore(db: ProjectionDatabase) {
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

  return { getCursor, advanceCursor }
}

