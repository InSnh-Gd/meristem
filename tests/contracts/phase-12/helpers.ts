import { createApprovalRoutes, createInMemoryApprovalStore } from '../../../services/m-policy/src/approval/index.ts'
import type { ActorId, Permission, PolicyApproval } from '../../../packages/contracts/src/index.ts'

export const internalToken = 'phase-12-test-internal-token'

process.env.MERISTEM_INTERNAL_TOKEN = internalToken

export function createTestApprovalRoutes(options: {
  actor?: ActorId
  permissions?: readonly Permission[]
  approvals?: PolicyApproval[]
  onApproved?: (approval: PolicyApproval) => Promise<void>
} = {}) {
  const actor = options.actor ?? 'security-admin'
  const grantedPermissions = options.permissions ?? ['policy:approval-read', 'policy:approval-approve', 'policy:approval-reject', 'policy:approval-manage']
  const store = createInMemoryApprovalStore(options.approvals ?? [])
  const timeline: Array<{ summary: string }> = []
  const fullLog: Array<{ message: string }> = []
  const auditLog: Array<{ action: string }> = []
  const published: Array<{ subject: string }> = []

  const deps = {
    auth: {
      async verify() {
        return { ok: true as const, actor }
      }
    },
    async permissionsForActor() {
      return grantedPermissions
    },
    approvals: store,
    log: {
      async writeTimeline(input: { summary: string }) { timeline.push(input) },
      async writeFull(input: { message: string }) { fullLog.push(input) },
      async writeAudit(input: { action: string }) { auditLog.push(input) }
    },
    events: {
      async publish(subject: string) { published.push({ subject }) }
    },
    ...(options.onApproved ? { onApproved: options.onApproved } : {})
  }
  const routes = createApprovalRoutes(deps)

  return { routes, store, timeline, fullLog, auditLog, published }
}

export function resumeBody(input: { approvalId?: string; policyDecisionId: string; approvalExpiresAt?: string }) {
  return JSON.stringify({
    approvalId: input.approvalId ?? 'approval-1',
    policyDecisionId: input.policyDecisionId,
    approvalStatus: 'approved',
    approvalExpiresAt: input.approvalExpiresAt ?? new Date(Date.now() + 3600_000).toISOString()
  })
}
