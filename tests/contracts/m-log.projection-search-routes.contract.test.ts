import { beforeEach, describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  type AuditLog,
  AuditLogSearchResponseSchema,
  type AuditSearchQuery,
  type BackfillParams,
  type BackfillResult,
  BackfillResultSchema,
  type DLQRecord,
  type FullLog,
  type FullLogSearchQuery,
  FullLogSearchResponseSchema,
  type LogSearchResult,
  ProjectionDLQResponseSchema,
  type ProjectionHealth,
  ProjectionHealthResponseSchema,
  ProjectionReplayResponseSchema,
  ProjectionSkipResponseSchema,
  type TimelineLog,
  TimelineLogSearchResponseSchema,
  type TimelineSearchQuery
} from '../../packages/contracts/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import type { LogAppDeps, ProjectionDeps, SearchDeps } from '../../services/m-log/src/deps.ts'
import { createProjectionSearchRoutes } from '../../services/m-log/src/projection-search-routes.ts'

const internalToken = 'm-log-projection-search-test-token'
const timestamp = '2026-06-18T10:00:00.000Z'

const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String
  })
})

const fullLog: FullLog = {
  id: 'full-1',
  timestamp,
  level: 'error',
  source: 'm-policy',
  message: 'policy timeout while approving operation',
  correlationId: 'corr-full-1',
  traceId: 'trace-full-1',
  payload: { operationId: 'op-1' }
}

const timelineLog: TimelineLog = {
  id: 'timeline-1',
  timestamp,
  summary: 'leaf node joined test-network',
  subject: 'node:leaf:test-node',
  correlationId: 'corr-timeline-1'
}

const auditLog: AuditLog = {
  id: 'audit-1',
  timestamp,
  actor: 'admin',
  action: 'network:profile-switch-apply',
  resource: 'network:test-network',
  decisionId: 'decision-1',
  result: 'allow',
  correlationId: 'corr-audit-1',
  traceId: 'trace-audit-1',
  payload: { reason: 'contract test' }
}

const projectionHealth: ProjectionHealth = {
  index: 'timeline-log',
  lagSeconds: 2,
  lastProjectedAt: timestamp,
  pendingCount: 1,
  dlqCount: 0,
  status: 'healthy'
}

const backfillResult: BackfillResult = {
  jobId: 'backfill-job-1',
  processedCount: 42,
  errors: 0,
  lastCursor: { factId: 'fact-42', timestamp },
  status: 'completed'
}

const dlqRecord: DLQRecord = {
  id: 'dlq-1',
  jobId: 'backfill-job-1',
  factId: 'fact-failed-1',
  index: 'full-log',
  error: 'projection mapping failed',
  attemptedAt: [timestamp],
  retries: 3,
  createdAt: timestamp
}

type DepsOptions = {
  searchAvailable?: boolean
  projectionAvailable?: boolean
  fullResult?: LogSearchResult<FullLog> | null
  timelineResult?: LogSearchResult<TimelineLog> | null
  auditResult?: LogSearchResult<AuditLog> | null
  health?: ProjectionHealth[]
  backfillResult?: BackfillResult
  backfillError?: Error
  dlqRecords?: DLQRecord[]
  replayResult?: boolean
}

type CapturedCalls = {
  fullQueries: FullLogSearchQuery[]
  timelineQueries: TimelineSearchQuery[]
  auditQueries: AuditSearchQuery[]
  backfillParams: BackfillParams[]
  dlqIndexes: Array<string | undefined>
  replayIds: string[]
  skipIds: string[]
}

async function decodeJson<TSchema extends Schema.Schema.AnyNoContext>(
  response: Response,
  schema: TSchema
): Promise<Schema.Schema.Type<TSchema>> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

function internalGet(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: internalHeaders() })
}

function internalPost(path: string, body?: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { ...internalHeaders(), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
}

function createTestDeps(options: DepsOptions = {}): { deps: LogAppDeps; calls: CapturedCalls } {
  const calls: CapturedCalls = {
    fullQueries: [],
    timelineQueries: [],
    auditQueries: [],
    backfillParams: [],
    dlqIndexes: [],
    replayIds: [],
    skipIds: []
  }

  const search: SearchDeps = {
    async full(query) {
      calls.fullQueries.push(query)
      return options.fullResult ?? { entries: [fullLog], total: 1 }
    },
    async timeline(query) {
      calls.timelineQueries.push(query)
      return options.timelineResult ?? { entries: [timelineLog], total: 1 }
    },
    async audit(query) {
      calls.auditQueries.push(query)
      return options.auditResult ?? { entries: [auditLog], total: 1 }
    },
    isAvailable() {
      return options.searchAvailable ?? true
    }
  }

  const projection: ProjectionDeps = {
    async getProjectionHealth() {
      return options.health ?? [projectionHealth]
    },
    async executeBackfill(params) {
      calls.backfillParams.push(params)
      if (options.backfillError) throw options.backfillError
      return options.backfillResult ?? backfillResult
    },
    async listDLQ(index) {
      calls.dlqIndexes.push(index)
      return options.dlqRecords ?? [dlqRecord]
    },
    async replayDLQ(dlqId) {
      calls.replayIds.push(dlqId)
      return options.replayResult ?? true
    },
    async skipDLQ(dlqId) {
      calls.skipIds.push(dlqId)
    },
    isAvailable() {
      return options.projectionAvailable ?? true
    }
  }

  return {
    calls,
    deps: {
      async readiness() {
        return { ready: true, opensearch: 'ready' }
      },
      async writeTimeline() {
        return timelineLog
      },
      async writeFull() {
        return fullLog
      },
      async writeAudit() {
        return auditLog
      },
      async listTimeline() {
        return [timelineLog]
      },
      async listFull() {
        return [fullLog]
      },
      async listAudit() {
        return [auditLog]
      },
      async reload() {
        return { serviceId: 'm-log', reloadedAt: timestamp }
      },
      search,
      projection
    }
  }
}

describe('M-Log projection search route contracts', () => {
  beforeEach(() => {
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('GET /internal/v0/search/full returns typed full-log search results', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalGet(
        '/internal/v0/search/full?q=timeout&from=2026-06-18T00%3A00%3A00.000Z&to=2026-06-18T12%3A00%3A00.000Z&limit=25&level=error&source=m-policy&correlationId=corr-full-1&traceId=trace-full-1'
      )
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, FullLogSearchResponseSchema)
    expect(body.entries).toEqual([fullLog])
    expect(body.total).toBe(1)
    expect(calls.fullQueries).toEqual([
      {
        q: 'timeout',
        from: '2026-06-18T00:00:00.000Z',
        to: '2026-06-18T12:00:00.000Z',
        limit: 25,
        level: 'error',
        source: 'm-policy',
        correlationId: 'corr-full-1',
        traceId: 'trace-full-1'
      }
    ])
  })

  it('GET /internal/v0/search/timeline returns typed timeline search results', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalGet(
        '/internal/v0/search/timeline?q=joined&limit=10&subject=node%3Aleaf%3Atest-node&correlationId=corr-timeline-1'
      )
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, TimelineLogSearchResponseSchema)
    expect(body.entries).toEqual([timelineLog])
    expect(calls.timelineQueries).toEqual([
      {
        q: 'joined',
        limit: 10,
        subject: 'node:leaf:test-node',
        correlationId: 'corr-timeline-1'
      }
    ])
  })

  it('GET /internal/v0/search/audit returns typed audit search results', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalGet(
        '/internal/v0/search/audit?q=allow&limit=5&actor=admin&action=network%3Aprofile-switch-apply&resource=network%3Atest-network&decisionId=decision-1&correlationId=corr-audit-1'
      )
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, AuditLogSearchResponseSchema)
    expect(body.entries).toEqual([auditLog])
    expect(calls.auditQueries).toEqual([
      {
        q: 'allow',
        limit: 5,
        actor: 'admin',
        action: 'network:profile-switch-apply',
        resource: 'network:test-network',
        decisionId: 'decision-1',
        correlationId: 'corr-audit-1'
      }
    ])
  })

  it('search routes fail closed when OpenSearch is unavailable', async () => {
    const { deps, calls } = createTestDeps({ searchAvailable: false })
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalGet('/internal/v0/search/full?q=timeout'))

    expect(response.status).toBe(503)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('search_unavailable')
    expect(calls.fullQueries).toEqual([])
  })

  it('GET /internal/v0/projection/health returns projection health metadata', async () => {
    const { deps } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalGet('/internal/v0/projection/health'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, ProjectionHealthResponseSchema)
    expect(body.indices).toEqual([projectionHealth])
  })

  it('projection routes reject missing internal tokens', async () => {
    const { deps } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(new Request('http://localhost/internal/v0/projection/health'))

    expect(response.status).toBe(401)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('internal.unauthorized')
  })

  it('POST /internal/v0/projection/backfill returns typed job results and normalized params', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalPost('/internal/v0/projection/backfill', {
        index: 'full-log',
        batchSize: 50,
        targetVersion: 'projection-v2'
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, BackfillResultSchema)
    expect(body).toEqual(backfillResult)
    expect(calls.backfillParams).toEqual([
      {
        index: 'full-log',
        from: null,
        to: null,
        batchSize: 50,
        targetVersion: 'projection-v2'
      }
    ])
  })

  it('POST /internal/v0/projection/backfill maps projection errors to 503', async () => {
    const { deps } = createTestDeps({ backfillError: new Error('cursor read failed') })
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalPost('/internal/v0/projection/backfill', {
        index: 'timeline-log',
        batchSize: 10
      })
    )

    expect(response.status).toBe(503)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error).toEqual({ code: 'backfill_failed', message: 'cursor read failed' })
  })

  it('GET /internal/v0/projection/dlq returns typed DLQ records for an index', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalGet('/internal/v0/projection/dlq?index=full-log'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, ProjectionDLQResponseSchema)
    expect(body.records).toEqual([dlqRecord])
    expect(calls.dlqIndexes).toEqual(['full-log'])
  })

  it('POST /internal/v0/projection/dlq/:id/replay returns replay contract', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalPost('/internal/v0/projection/dlq/dlq-1/replay'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, ProjectionReplayResponseSchema)
    expect(body.replayed).toBe(true)
    expect(calls.replayIds).toEqual(['dlq-1'])
  })

  it('POST /internal/v0/projection/dlq/:id/replay returns 404 when replay fails', async () => {
    const { deps } = createTestDeps({ replayResult: false })
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(
      internalPost('/internal/v0/projection/dlq/missing-dlq/replay')
    )

    expect(response.status).toBe(404)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('dlq_not_found_or_replay_failed')
  })

  it('POST /internal/v0/projection/dlq/:id/skip returns skip contract', async () => {
    const { deps, calls } = createTestDeps()
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalPost('/internal/v0/projection/dlq/dlq-1/skip'))

    expect(response.status).toBe(200)
    const body = await decodeJson(response, ProjectionSkipResponseSchema)
    expect(body.skipped).toBe(true)
    expect(calls.skipIds).toEqual(['dlq-1'])
  })

  it('projection routes fail closed when the projection engine is unavailable', async () => {
    const { deps, calls } = createTestDeps({ projectionAvailable: false })
    const app = createProjectionSearchRoutes(deps)

    const response = await app.handle(internalGet('/internal/v0/projection/dlq?index=full-log'))

    expect(response.status).toBe(503)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('projection_unavailable')
    expect(calls.dlqIndexes).toEqual([])
  })
})
