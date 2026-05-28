import { err, ok } from '../../../packages/common/src/result.ts'
import { verifyLocalToken } from '../../../packages/auth/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { createDynamicRouteAdapter } from '../../../packages/internal-http/src/dynamic-routes.ts'
import { createInternalFetcher, internalRequestHeaders, internalServicePorts, serveHttpApp, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { currentTraceId, initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createEventEnvelope, type MEventEnvelope } from '../../../packages/events/src/index.ts'
import { createMTaskApp } from './app.ts'
import { createDbMTaskStorage } from './storage-adapter.ts'
import { createDbSuspendedOperationStore } from './suspended-operation/index.ts'
import type { CreateApprovalResponse, MTaskPolicyDecision } from '../../../packages/contracts/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/app.ts'
import { edenTreaty } from '@elysiajs/eden'

initTelemetry('m-task')

// Phase 12 起 M-Task 显式连接 M-Policy、M-EventBus 和 PostgreSQL，避免生产路径复用测试内存端口。
const { db, client } = createDb()
const policyRoutes = createDynamicRouteAdapter({
  baseUrl: serviceUrl('m-policy'),
  traceHeaders: () => internalRequestHeaders(),
  fetcher: createInternalFetcher()
})
const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), { fetcher: createInternalFetcher() })

async function publishEvent(subject: string, event: MEventEnvelope) {
  const result = await eventBus.internal.v0.publish.post({ subject, event })
  if (result.error || !result.data) return err({ code: 'event.publish_failed', message: `failed to publish ${subject}` })
  return ok({ eventId: result.data.eventId })
}

function logEvent(type: 'log.timeline' | 'log.full' | 'audit.entry.created', payload: unknown) {
  const traceId = currentTraceId()
  return createEventEnvelope({
    type,
    source: 'm-task',
    payload,
    ...(traceId ? { traceId } : {})
  })
}

const app = createMTaskApp({
  storage: createDbMTaskStorage(db),
  suspendedOps: createDbSuspendedOperationStore(db),
  events: { publish: publishEvent },
  log: {
    async writeTimeline(input) {
      const published = await publishEvent('log.timeline.v0', logEvent('log.timeline', input))
      return published.ok ? ok({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }) : published
    },
    async writeFull(input) {
      const published = await publishEvent('log.full.v0', logEvent('log.full', input))
      return published.ok ? ok({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }) : published
    },
    async writeAudit(input) {
      const published = await publishEvent('audit.entry.created.v0', logEvent('audit.entry.created', input))
      return published.ok ? ok({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }) : published
    }
  },
  delivery: {
    async submitDelivery() {
      return ok({ completedAt: new Date().toISOString() })
    },
    async cancelDelivery() {
      return ok('cancelAccepted')
    }
  },
  approvals: {
    async create(input) {
      return policyRoutes.postJson<CreateApprovalResponse>('/internal/v0/policy/approvals', {
        body: {
          policyDecisionId: input.policyDecisionId,
          originService: 'm-task',
          operationId: input.operationId,
          requestedBy: input.requestedBy,
          requiredAction: input.requiredAction,
          expiresAt: input.expiresAt
        }
      })
    }
  },
  policy: {
    async decide(input) {
      const result = await policyRoutes.postJson<{ decision: MTaskPolicyDecision }>('/internal/v0/authorize', {
        body: {
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          correlationId: input.correlationId,
          risk: input.risk
        }
      })
      return result.ok ? ok(result.value.decision) : err(result.error)
    }
  },
  auth: {
    async verify(token: string) {
      const secret = process.env.MERISTEM_JWT_SECRET
      if (!secret) return err({ code: 'auth.unconfigured', message: 'MERISTEM_JWT_SECRET is required' })
      const verified = await verifyLocalToken({ token, secret })
      return verified.ok ? ok({ actor: verified.actor }) : err({ code: verified.code, message: verified.message })
    }
  }
})

const server = serveHttpApp('m-task', app.fetch)

process.on('SIGINT', () => {
  void server.stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-task listening on http://127.0.0.1:${internalServicePorts['m-task']}`)
