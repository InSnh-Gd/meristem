export type LogSearchQuery = {
  q?: string
  from?: string
  to?: string
  limit?: number
}

export type FullLogSearchQuery = LogSearchQuery & {
  level?: 'debug' | 'info' | 'warn' | 'error'
  source?: string
  correlationId?: string
  traceId?: string
}

export type TimelineSearchQuery = LogSearchQuery & {
  subject?: string
  correlationId?: string
}

export type AuditSearchQuery = LogSearchQuery & {
  actor?: string
  action?: string
  resource?: string
  decisionId?: string
  correlationId?: string
}

export type LogSearchResult<T> = {
  entries: T[]
  total: number
}

export type ProjectorJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ProjectorJobType = 'backfill' | 'incremental' | 'repair'

export type ProjectionCursor = {
  factId: string
  timestamp: string
}

export type ProjectorJob = {
  id: string
  type: ProjectorJobType
  index: string
  startCursor: ProjectionCursor | null
  endCursor: ProjectionCursor | null
  batchSize: number
  status: ProjectorJobStatus
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type DLQRecord = {
  id: string
  jobId: string
  factId: string
  index: string
  error: string
  attemptedAt: string[]
  retries: number
  createdAt: string
}

export type ProjectionHealth = {
  index: string
  lagSeconds: number
  lastProjectedAt: string | null
  pendingCount: number
  dlqCount: number
  status: 'healthy' | 'degraded' | 'unavailable'
}

export type BackfillParams = {
  index: string
  from: ProjectionCursor | null
  to: ProjectionCursor | null
  batchSize: number
  targetVersion?: string
}

export type BackfillResult = {
  jobId: string
  processedCount: number
  errors: number
  lastCursor: ProjectionCursor | null
  status: ProjectorJobStatus
}
