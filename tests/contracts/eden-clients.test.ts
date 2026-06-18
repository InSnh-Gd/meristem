import { describe, expect, it } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import type {
  AuditSearchQuery,
  FullLogSearchQuery,
  TimelineSearchQuery
} from '../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../packages/events/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createEventBusApp } from '../../services/m-eventbus/src/app.ts'
import type { EventBusApp } from '../../services/m-eventbus/src/public-types.ts'
import { createLogApp } from '../../services/m-log/src/app.ts'
import type { LogApp } from '../../services/m-log/src/public-types.ts'
import { createPolicyApp } from '../../services/m-policy/src/app.ts'
import type { PolicyApp } from '../../services/m-policy/src/public-types.ts'

const internalToken = 'internal-test-token'

function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

type LocalFetchApp = {
  handle(request: Request): Response | Promise<Response>
}

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

function localFetcher(app: LocalFetchApp): typeof fetch {
  const fetcher = (input: FetchInput, init?: FetchInit) => {
    const requestInit = {
      ...init,
      headers: new Headers({
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        ...internalHeaders()
      })
    }
    const request =
      typeof input === 'string'
        ? new Request(input, requestInit)
        : input instanceof URL
          ? new Request(input.toString(), requestInit)
          : new Request(input, requestInit)
    return app.handle(request)
  }

  return Object.assign(fetcher, { preconnect: fetch.preconnect }) as typeof fetch
}

describe('Eden clients', () => {
  process.env.MERISTEM_INTERNAL_TOKEN = internalToken

  it('supports typed Core status calls through Eden', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const client = treaty<typeof app>(app)

    const response = await client.api.v0.status.get({
      headers: {
        authorization: 'Bearer operator-token'
      }
    })

    expect(response.error).toBeNull()
    const data = response.data
    expect(data?.core.id).toBe('meristem-core')
    expect(data?.counts.nodes).toBe(0)
  })

  it('supports typed internal policy authorization calls through Eden', async () => {
    const app = createPolicyApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      async authorize(input) {
        return {
          id: 'decision-1',
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          result: 'allow',
          reasons: ['role match'],
          createdAt: new Date().toISOString()
        }
      },
      async getDecision(id) {
        return {
          id,
          actor: 'operator',
          action: 'core:read',
          resource: 'core',
          result: 'allow',
          reasons: ['role match'],
          createdAt: new Date().toISOString()
        }
      },
      async getSummary() {
        return {
          generatedAt: new Date().toISOString(),
          decisions: {
            total: 1,
            allow: 1,
            deny: 0,
            requireManualReview: 0,
            requireMultiApproval: 0
          },
          recentDecisions: [],
          approvals: {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            expired: 0,
            canceled: 0
          },
          pendingApprovals: []
        }
      }
    })
    const client = treaty<PolicyApp>('http://internal.test', { fetcher: localFetcher(app) })

    const response = await client.internal.v0.authorize.post({
      actor: 'operator',
      action: 'core:read',
      resource: 'core'
    })

    expect(response.error).toBeNull()
    expect(response.data?.decision.result).toBe('allow')
  })

  it('supports typed internal log writes through Eden', async () => {
    const writes: Array<{ action: string; traceId?: string }> = []
    const app = createLogApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      async writeTimeline(input) {
        writes.push({ action: input.summary })
        return { id: 'timeline-1', timestamp: new Date().toISOString(), ...input }
      },
      async writeFull(input) {
        writes.push(
          input.traceId
            ? { action: input.message, traceId: input.traceId }
            : { action: input.message }
        )
        return { id: 'full-1', timestamp: new Date().toISOString(), ...input }
      },
      async writeAudit(input) {
        writes.push(
          input.traceId
            ? { action: input.action, traceId: input.traceId }
            : { action: input.action }
        )
        return { id: 'audit-1', timestamp: new Date().toISOString(), ...input }
      },
      async listTimeline() {
        return []
      },
      async listFull() {
        return []
      },
      async listAudit() {
        return []
      },
      async reload() {
        return {
          serviceId: 'm-log',
          reloadedAt: new Date().toISOString()
        }
      },
      // search deps
      search: {
        async full(_query: FullLogSearchQuery) {
          return null
        },
        async timeline(_query: TimelineSearchQuery) {
          return null
        },
        async audit(_query: AuditSearchQuery) {
          return null
        },
        isAvailable() {
          return false
        }
      },
      projection: {
        async getProjectionHealth() {
          return []
        },
        async executeBackfill() {
          return {
            jobId: '',
            processedCount: 0,
            errors: 0,
            lastCursor: null,
            status: 'completed' as const
          }
        },
        async listDLQ() {
          return []
        },
        async replayDLQ() {
          return false
        },
        async skipDLQ() {
          return Promise.resolve()
        },
        isAvailable() {
          return false
        }
      }
    })
    const client = treaty<LogApp>('http://internal.test', { fetcher: localFetcher(app) })

    const response = await client.internal.v0.audit.post({
      actor: 'operator',
      action: 'node:register',
      resource: 'node:leaf:test',
      result: 'allow',
      traceId: '0123456789abcdef0123456789abcdef'
    })

    expect(response.error).toBeNull()
    expect(response.data?.entry.traceId).toBe('0123456789abcdef0123456789abcdef')
    expect(writes[0]?.action).toBe('node:register')
  })

  it('supports typed internal log reload calls through Eden', async () => {
    const app = createLogApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      async writeTimeline() {
        throw new Error('not used')
      },
      async writeFull() {
        throw new Error('not used')
      },
      async writeAudit() {
        throw new Error('not used')
      },
      async listTimeline() {
        return []
      },
      async listFull() {
        return []
      },
      async listAudit() {
        return []
      },
      async reload() {
        return {
          serviceId: 'm-log',
          reloadedAt: new Date().toISOString()
        }
      },
      // search deps
      search: {
        async full(_query: FullLogSearchQuery) {
          return null
        },
        async timeline(_query: TimelineSearchQuery) {
          return null
        },
        async audit(_query: AuditSearchQuery) {
          return null
        },
        isAvailable() {
          return false
        }
      },
      projection: {
        async getProjectionHealth() {
          return []
        },
        async executeBackfill() {
          return {
            jobId: '',
            processedCount: 0,
            errors: 0,
            lastCursor: null,
            status: 'completed' as const
          }
        },
        async listDLQ() {
          return []
        },
        async replayDLQ() {
          return false
        },
        async skipDLQ() {
          return Promise.resolve()
        },
        isAvailable() {
          return false
        }
      }
    })
    const client = treaty<LogApp>('http://internal.test', { fetcher: localFetcher(app) })

    const response = await client.internal.v0.lifecycle.reload.post({
      reason: 'typed reload test'
    })

    expect(response.error).toBeNull()
    expect(response.data?.serviceId).toBe('m-log')
  })

  it('supports typed event publish calls through Eden', async () => {
    const published: string[] = []
    const app = createEventBusApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      publishMetricsSummary() {
        return {
          service: 'm-eventbus' as const,
          generatedAt: '2026-06-18T00:00:00.000Z',
          windowStartedAt: '2026-06-18T00:00:00.000Z',
          totals: { success: 0, rejected: 0, failed: 0, retryAttempts: 0 },
          subjects: []
        }
      },
      async publish(subject, event) {
        published.push(subject)
        return { eventId: event.id }
      },
      async reportRejected() {
        return Promise.resolve()
      }
    })
    const client = treaty<EventBusApp>('http://internal.test', { fetcher: localFetcher(app) })

    const response = await client.internal.v0.publish.post({
      subject: 'node.registration.accepted.v0',
      event: createEventEnvelope({
        type: 'node.registration.accepted',
        source: 'meristem-core',
        payload: { nodeId: 'node-1' },
        correlationId: 'corr-1'
      })
    })

    expect(response.error).toBeNull()
    expect(response.data?.eventId).toBeDefined()
    expect(published).toEqual(['node.registration.accepted.v0'])
  })

  it('rejects internal requests without the shared token', async () => {
    const app = createPolicyApp({
      async readiness() {
        return { ready: true, opensearch: 'unavailable' as const }
      },
      async authorize() {
        throw new Error('should not run')
      },
      async getDecision() {
        return null
      },
      async getSummary() {
        return {
          generatedAt: new Date().toISOString(),
          decisions: {
            total: 0,
            allow: 0,
            deny: 0,
            requireManualReview: 0,
            requireMultiApproval: 0
          },
          recentDecisions: [],
          approvals: {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            expired: 0,
            canceled: 0
          },
          pendingApprovals: []
        }
      }
    })
    const client = treaty<PolicyApp>(app)

    const response = await client.internal.v0.authorize.post({
      actor: 'operator',
      action: 'core:read',
      resource: 'core'
    })

    expect(response.status).toBe(401)
    expect(response.error?.value).toEqual({
      error: { code: 'internal.unauthorized', message: 'invalid internal token' }
    })
  })
})
