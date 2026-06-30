import type { ActorId, PolicyApproval } from '../../../packages/contracts/src/index.ts'
import {
  createApprovalRoutes,
  createInMemoryApprovalStore
} from '../../../services/m-policy/src/approvals.ts'

export function createTestApprovalRoutes(
  options: {
    actor?: ActorId
    approvals?: PolicyApproval[]
    onApproved?: (approval: PolicyApproval) => Promise<void>
    onRejected?: (approval: PolicyApproval) => Promise<void>
  } = {}
) {
  const actor = options.actor ?? 'security-admin'
  const store = createInMemoryApprovalStore(options.approvals ?? [])
  const timeline: Array<{ summary: string }> = []
  const fullLog: Array<{ message: string }> = []
  const auditLog: Array<{ action: string; actor?: ActorId | 'system' }> = []
  const published: Array<{ subject: string }> = []

  const routes = createApprovalRoutes({
    auth: {
      async verify() {
        return { ok: true as const, actor }
      }
    },
    approvals: store,
    log: {
      async writeTimeline(input) {
        timeline.push(input)
      },
      async writeFull(input) {
        fullLog.push(input)
      },
      async writeAudit(input) {
        auditLog.push(input)
      }
    },
    events: {
      async publish(subject) {
        published.push({ subject })
      }
    },
    async authorize() {
      return true
    },
    ...(options.onApproved ? { onApproved: options.onApproved } : {}),
    ...(options.onRejected ? { onRejected: options.onRejected } : {})
  })

  return { routes, store, timeline, fullLog, auditLog, published }
}
