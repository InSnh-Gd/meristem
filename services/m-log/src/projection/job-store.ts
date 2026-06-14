import { eq } from 'drizzle-orm'
import type {
  ProjectionCursor,
  ProjectorJob,
  ProjectorJobStatus,
  ProjectorJobType
} from '../../../../packages/contracts/src/index.ts'
import { projectorJobs } from '../../../../packages/db/src/schema.ts'
import type { ProjectionDatabase } from './types.ts'

/**
 * Creates a projection job-store facade over the authoritative PostgreSQL job table.
 */
export function createJobStore(db: ProjectionDatabase) {
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
      startCursor: startCursor
        ? { factId: startCursor.factId, timestamp: startCursor.timestamp }
        : null,
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

  async function transitionJob(
    id: string,
    status: ProjectorJobStatus,
    error?: string
  ): Promise<void> {
    const now = new Date()
    const updates: Record<string, unknown> = { status, updatedAt: now }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = now
    }
    if (error !== undefined) {
      updates.error = error
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

  return { createJob, transitionJob, getJob }
}

/**
 * Maps a Drizzle job row into the public projection job contract.
 */
function mapJobRow(row: Record<string, unknown>): ProjectorJob {
  return {
    id: row.id as string,
    type: row.type as ProjectorJobType,
    index: row.index as string,
    startCursor: row.startCursor
      ? {
          factId: String((row.startCursor as Record<string, unknown>).factId ?? ''),
          timestamp: String((row.startCursor as Record<string, unknown>).timestamp ?? '')
        }
      : null,
    endCursor: row.endCursor
      ? {
          factId: String((row.endCursor as Record<string, unknown>).factId ?? ''),
          timestamp: String((row.endCursor as Record<string, unknown>).timestamp ?? '')
        }
      : null,
    batchSize: row.batchSize as number,
    status: row.status as ProjectorJobStatus,
    error: row.error as string | null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
    completedAt: row.completedAt ? (row.completedAt as Date).toISOString() : null
  }
}
