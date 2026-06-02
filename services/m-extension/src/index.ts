import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { fetchReadyState, internalApiPaths, internalRequestHeaders, serveHttpApp, serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { ActorId, Permission } from '../../../packages/contracts/src/index.ts'
import { mExtensionServiceName } from '../../../packages/contracts/src/types/extension.ts'
import { createMExtensionApp } from './app.ts'
import { createDbExtensionStore } from './db-store.ts'

function requiredJwtSecret(): string {
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
  return secret
}

initTelemetry(mExtensionServiceName)
const { db, client } = createDb()

const app = createMExtensionApp({
  jwtSecret: requiredJwtSecret(),
  store: createDbExtensionStore(db),
  policy: {
    async authorize(actor: ActorId, action: Permission, resource: string) {
      const response = await fetch(`${serviceUrl('m-policy')}${internalApiPaths.authorize}`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ actor, action, resource })
      })
      if (!response.ok) throw new Error('M-Policy unavailable')
      const body = await response.json() as { decision: { result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'; id: string; reasons: string[] } }
      return { result: body.decision.result, id: body.decision.id, reasons: body.decision.reasons }
    }
  },
  log: {
    async writeTimeline(summary, subject, correlationId) {
      const response = await fetch(`${serviceUrl('m-log')}${internalApiPaths.timelineLog}`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ summary, ...(subject ? { subject } : {}), ...(correlationId ? { correlationId } : {}) })
      })
      if (!response.ok) throw new Error('failed to write timeline log')
    },
    async writeFull(level: 'debug' | 'info' | 'warn' | 'error', message, correlationId, payload) {
      const response = await fetch(`${serviceUrl('m-log')}${internalApiPaths.fullLog}`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ level, source: mExtensionServiceName, message, ...(correlationId ? { correlationId } : {}), ...(payload ? { payload } : {}) })
      })
      if (!response.ok) throw new Error('failed to write full log')
    },
    async writeAudit(actor, action, resource, result, correlationId, payload) {
      const decisionId = typeof payload === 'object' && payload !== null && 'decisionId' in payload && typeof payload.decisionId === 'string' ? payload.decisionId : undefined
      const body = { actor, action, resource, result, correlationId, ...(decisionId ? { decisionId } : {}), payload }
      const response = await fetch(`${serviceUrl('m-log')}${internalApiPaths.auditLog}`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error('failed to write audit log')
    }
  },
  events: {
    async publish(subject, type, payload, correlationId) {
      const event = createEventEnvelope({ type, source: mExtensionServiceName, payload, ...(correlationId ? { correlationId } : {}) })
      const response = await fetch(`${serviceUrl('m-eventbus')}${internalApiPaths.publishEvent}`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ subject, event })
      })
      if (!response.ok) throw new Error(`failed to publish ${subject}`)
    }
  },
  async readiness() {
    const postgresReady = await client`select 1`.then(() => true).catch(() => false)
    const [policyReady, logReady, eventBusReady] = await Promise.all([
      fetchReadyState(`${serviceUrl('m-policy')}/ready`),
      fetchReadyState(`${serviceUrl('m-log')}/ready`),
      fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    ])
    return { ready: postgresReady && policyReady && logReady && eventBusReady }
  }
})

const server = serveHttpApp(mExtensionServiceName, app.fetch)

console.log(`${mExtensionServiceName} listening on ${server.url}`)

process.on('SIGINT', () => {
  server.stop()
  void client.end().then(() => shutdownTelemetry()).finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.stop()
  void client.end().then(() => shutdownTelemetry()).finally(() => process.exit(0))
})
