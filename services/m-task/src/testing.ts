import { ok } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  AuditLog,
  FullLog,
  MTask,
  MTaskPolicyDecision,
  Permission,
  PolicyResult,
  TaskPolicyResult,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import type { MEventEnvelope } from '../../../packages/events/src/index.ts'
import { decidePermission, rolePermissions } from '../../../packages/policy/src/index.ts'
import type { MTaskDeps } from './deps.ts'

type DeliveryMode = 'complete' | 'queued'

export type InMemoryMTaskOptions = {
  actor?: ActorId
  deliveryMode?: DeliveryMode
  forcePolicyResult?: Exclude<PolicyResult, 'allow'>
}

function requiredActionFor(
  result: TaskPolicyResult
): MTaskPolicyDecision['requiredAction'] | undefined {
  if (result === 'require_manual_review') return 'manual_review'
  if (result === 'require_multi_approval') return 'multi_approval'
  return undefined
}

export function createInMemoryMTaskDeps(options: InMemoryMTaskOptions = {}): MTaskDeps & {
  __testing: {
    auditEntries(): AuditLog[]
    fullEntries(): FullLog[]
    publishedSubjects(): string[]
    auditActions(): string[]
    timelineSummaries(): string[]
    fullMessages(): string[]
  }
} {
  const actor = options.actor ?? 'operator'
  const tasks: MTask[] = [
    {
      id: 'task-existing',
      nodeId: 'node-leaf-1',
      leafNodeId: 'node-leaf-1',
      type: 'noop',
      status: 'failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
  const published: Array<{ subject: string; event: MEventEnvelope }> = []
  const timeline: TimelineLog[] = []
  const full: FullLog[] = []
  const audit: AuditLog[] = []

  return {
    auth: {
      async verify() {
        return ok({ actor })
      }
    },
    policy: {
      async decide(input) {
        const draft = decidePermission({
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          permissions: rolePermissions[input.actor] as readonly Permission[]
        })
        const forced = options.forcePolicyResult
        const result = forced ?? draft.result
        return ok({
          decisionId: crypto.randomUUID(),
          result,
          requiredAction: requiredActionFor(result),
          reasons: forced ? [`forced:${forced}`] : draft.reasons
        })
      }
    },
    log: {
      async writeTimeline(input) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        timeline.push(entry)
        return ok(entry)
      },
      async writeFull(input) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        full.push(entry)
        return ok(entry)
      },
      async writeAudit(input) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        audit.push(entry)
        return ok(entry)
      }
    },
    events: {
      async publish(subject, event) {
        published.push({ subject, event })
        return ok({ eventId: event.id })
      }
    },
    delivery: {
      async submitDelivery() {
        return options.deliveryMode === 'queued'
          ? ok({ queued: true as const })
          : ok({ completedAt: new Date().toISOString() })
      },
      async cancelDelivery() {
        return ok('cancelAccepted')
      }
    },
    storage: {
      async create(input) {
        const now = new Date().toISOString()
        const task: MTask = {
          id: crypto.randomUUID(),
          nodeId: input.nodeId,
          leafNodeId: input.nodeId,
          type: input.type,
          status: 'accepted',
          createdAt: now,
          updatedAt: now,
          ...(input.timeoutAt ? { timeoutAt: input.timeoutAt } : {})
        }
        tasks.push(task)
        return task
      },
      async list() {
        return [...tasks]
      },
      async get(id) {
        return tasks.find(task => task.id === id) ?? null
      },
      async transition(id, status, patch = {}) {
        const task = tasks.find(candidate => candidate.id === id)
        if (!task) return null
        task.status = status
        task.updatedAt = new Date().toISOString()
        if (patch.completedAt) task.completedAt = patch.completedAt
        if (patch.canceledAt) task.canceledAt = patch.canceledAt
        return task
      }
    },
    __testing: {
      auditEntries: () => [...audit],
      fullEntries: () => [...full],
      publishedSubjects: () => published.map(entry => entry.subject),
      auditActions: () => audit.map(entry => entry.action),
      timelineSummaries: () => timeline.map(entry => entry.summary),
      fullMessages: () => full.map(entry => entry.message)
    }
  }
}
