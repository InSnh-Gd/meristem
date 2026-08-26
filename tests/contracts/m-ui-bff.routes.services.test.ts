import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createEventBusApp } from '../../services/m-eventbus/src/app.ts'
import {
  createBffWithCore,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerRoutesServicesContractTests(): void {
  function createPolicySummaryApp() {
    return new Elysia().get('/internal/v0/summary', () => ({
      generatedAt: '2026-06-18T00:00:00.000Z',
      decisions: {
        total: 4,
        allow: 1,
        deny: 1,
        requireManualReview: 1,
        requireMultiApproval: 1,
        latestCreatedAt: '2026-06-18T00:00:00.000Z'
      },
      recentDecisions: [
        {
          id: 'decision-1',
          actor: 'admin',
          action: 'task:submit',
          resource: 'task:123',
          result: 'require_multi_approval',
          createdAt: '2026-06-18T00:00:00.000Z'
        }
      ],
      approvals: {
        total: 3,
        pending: 1,
        approved: 1,
        rejected: 1,
        expired: 0,
        canceled: 0,
        latestCreatedAt: '2026-06-18T00:00:00.000Z',
        nextExpiryAt: '2026-06-18T01:00:00.000Z'
      },
      pendingApprovals: [
        {
          approvalId: 'approval-1',
          policyDecisionId: 'decision-1',
          requestedBy: 'admin',
          requiredAction: 'multi_approval',
          status: 'pending',
          createdAt: '2026-06-18T00:00:00.000Z',
          expiresAt: '2026-06-18T01:00:00.000Z'
        }
      ]
    }))
  }

  describe('SDUI v0.2 BFF routes', () => {
    it('GET /api/v0/services returns service list', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(app, '/api/v0/services', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { services: Array<{ id: string }> }
      expect(Array.isArray(body.services)).toBe(true)
    })

    it('GET /api/v0/services/:id returns service inspector with EventBus metrics for m-eventbus', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const eventbusApp = createEventBusApp({
        async readiness() {
          return { ready: true, opensearch: 'unavailable' as const }
        },
        publishMetricsSummary() {
          return {
            service: 'm-eventbus' as const,
            generatedAt: '2026-06-18T00:00:00.000Z',
            windowStartedAt: '2026-06-18T00:00:00.000Z',
            totals: { success: 12, rejected: 2, failed: 1, retryAttempts: 4 },
            subjects: []
          }
        },
        async publish(_subject, event) {
          return { eventId: event.id }
        },
        async reportRejected() {
          return
        }
      })
      const app = createBffWithServices({ coreApp, eventbusApp })

      const res = await makeRequest(app, '/api/v0/services/m-eventbus', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        service: { id: string; stateSource: { sourceType: string; sourceId: string } }
        eventBusMetrics: { totals: { success: number; failed: number } } | null
        eventBusMetricsStateSource: { sourceType: string; sourceId: string } | null
        logProjectionHealth: unknown
        policySummary: unknown
      }
      expect(body.service.id).toBe('m-eventbus')
      expect(body.service.stateSource.sourceType).toBe('authoritative')
      expect(body.eventBusMetrics?.totals.success).toBe(12)
      expect(body.eventBusMetrics?.totals.failed).toBe(1)
      expect(body.eventBusMetricsStateSource).toEqual({
        sourceType: 'read-model',
        sourceId: 'm-eventbus:/internal/v0/metrics/publish-summary'
      })
      expect(body.logProjectionHealth).toBeNull()
      expect(body.policySummary).toBeNull()
    })

    it('GET /api/v0/services/:id returns projection health for m-log', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(app, '/api/v0/services/m-log', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        service: { id: string }
        eventBusMetrics: unknown
        eventBusMetricsStateSource: unknown
        logProjectionHealth: { indices: Array<{ index: string; status: string }> } | null
        logProjectionHealthStateSource: { sourceType: string; sourceId: string } | null
        policySummary: unknown
      }
      expect(body.service.id).toBe('m-log')
      expect(body.eventBusMetrics).toBeNull()
      expect(body.eventBusMetricsStateSource).toBeNull()
      expect(Array.isArray(body.logProjectionHealth?.indices)).toBe(true)
      expect(body.logProjectionHealthStateSource).toEqual({
        sourceType: 'read-model',
        sourceId: 'core:/api/v0/projection/health'
      })
      expect(body.policySummary).toBeNull()
    })

    it('GET /api/v0/services/:id returns policy summary for m-policy', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithServices({ coreApp, policyApp: createPolicySummaryApp() })

      const res = await makeRequest(app, '/api/v0/services/m-policy', 'GET', 'admin-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        service: { id: string }
        eventBusMetrics: unknown
        logProjectionHealth: unknown
        policySummary: {
          approvals: { total: number; pending: number }
          decisions: { total: number }
          recentDecisions: Array<{ id: string }>
          pendingApprovals: Array<{ approvalId: string; status: string }>
        } | null
        policySummaryStateSource: { sourceType: string; sourceId: string } | null
      }
      expect(body.service.id).toBe('m-policy')
      expect(body.eventBusMetrics).toBeNull()
      expect(body.logProjectionHealth).toBeNull()
      expect(body.policySummary?.approvals.total).toBe(3)
      expect(body.policySummary?.approvals.pending).toBe(1)
      expect(body.policySummary?.decisions.total).toBe(4)
      expect(body.policySummary?.recentDecisions[0]?.id).toBe('decision-1')
      expect(Array.isArray(body.policySummary?.pendingApprovals)).toBe(true)
      expect(body.policySummaryStateSource).toEqual({
        sourceType: 'policy',
        sourceId: 'm-policy:/internal/v0/summary'
      })
    })

    it('GET /api/v0/services/:id keeps optional service sections null for unrelated services', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(app, '/api/v0/services/m-net', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        service: { id: string }
        eventBusMetrics: unknown
        eventBusMetricsStateSource: unknown
        logProjectionHealth: unknown
        logProjectionHealthStateSource: unknown
        policySummary: unknown
        policySummaryStateSource: unknown
      }
      expect(body.service.id).toBe('m-net')
      expect(body.eventBusMetrics).toBeNull()
      expect(body.eventBusMetricsStateSource).toBeNull()
      expect(body.logProjectionHealth).toBeNull()
      expect(body.logProjectionHealthStateSource).toBeNull()
      expect(body.policySummary).toBeNull()
      expect(body.policySummaryStateSource).toBeNull()
    })
  })
}
