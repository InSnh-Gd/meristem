import { verifyLocalToken } from '../../../packages/auth/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  fetchReadyState,
  internalRequestHeaders,
  probePostgresReadiness,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import type { ApprovalDeps } from './approval-schemas.ts'
import { createPgApprovalStore } from './approval-store.ts'
import type { createPolicyDecisionStore } from './decision-store.ts'
import type { PolicyEventPublisher } from './event-publisher.ts'

export function createPolicyApprovalDeps(
  db: MeristemDb,
  publisher: PolicyEventPublisher,
  decisionStore: ReturnType<typeof createPolicyDecisionStore>
): ApprovalDeps {
  const approvalStore = createPgApprovalStore(db)

  return {
    auth: {
      async verify(token) {
        const secret = process.env.MERISTEM_JWT_SECRET
        if (!secret) {
          return {
            ok: false as const,
            code: 'auth.unconfigured',
            message: 'MERISTEM_JWT_SECRET is required'
          }
        }
        const result = await verifyLocalToken({ token, secret })
        if (!result.ok) return { ok: false as const, code: result.code, message: result.message }
        return { ok: true as const, actor: result.actor }
      }
    },
    approvals: approvalStore,
    log: {
      writeTimeline(input) {
        return publisher.publishLog('timeline', input)
      },
      writeFull(input) {
        return publisher.publishLog('full', input)
      },
      writeAudit(input) {
        return publisher.publishLog('audit', input)
      }
    },
    events: {
      publish(subject, event) {
        return publisher.publishSubject(subject, event)
      }
    },
    authorize(actor, permission, resource) {
      return decisionStore.hasPermission(actor, permission, resource)
    },
    async onApproved(approval) {
      if (approval.originService === 'm-net') {
        const response = await fetch(
          `${serviceUrl('m-net')}/internal/v0/network-profile-operations/${approval.operationId}/resume`,
          {
            method: 'POST',
            headers: internalRequestHeaders()
          }
        )
        if (!response.ok) throw new Error('m-net resume failed')
        return
      }
      const response = await fetch(
        `${serviceUrl('m-task')}/internal/v0/task-operations/${approval.operationId}/resume`,
        {
          method: 'POST',
          headers: internalRequestHeaders()
        }
      )
      if (!response.ok) throw new Error('m-task resume failed')
    },
    async onRejected(approval) {
      if (approval.originService === 'm-net') {
        const response = await fetch(
          `${serviceUrl('m-net')}/internal/v0/network-profile-operations/${approval.operationId}/reject`,
          {
            method: 'POST',
            headers: internalRequestHeaders()
          }
        )
        if (!response.ok) throw new Error('m-net reject failed')
        return
      }
      const response = await fetch(
        `${serviceUrl('m-task')}/internal/v0/task-operations/${approval.operationId}/reject`,
        {
          method: 'POST',
          headers: internalRequestHeaders()
        }
      )
      if (!response.ok) throw new Error('m-task reject failed')
    }
  }
}

export function createPolicyReadiness(
  client: ReturnType<typeof import('../../../packages/db/src/client.ts').createDb>['client']
) {
  return async function readiness(): Promise<{ ready: boolean }> {
    const postgresReady = await probePostgresReadiness({
      client,
      service: 'm-policy',
      readyValue: true,
      fallback: false,
      warn: ({ message }) => console.warn(message)
    })
    const eventBusReady = await fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    return { ready: postgresReady && eventBusReady }
  }
}
