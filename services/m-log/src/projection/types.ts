export type ProjectionDatabase = ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>

export type ProjectionOpenSearch = {
  indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<boolean>
  searchTimeline?: (q: Record<string, unknown>) => Promise<unknown>
  ensureIndex?(index: string): Promise<boolean>
  ensureAllIndices?: () => Promise<boolean>
  health?: () => Promise<boolean>
}
