import { edenTreaty } from '@elysiajs/eden'
import { eq } from 'drizzle-orm'
import { verifyLocalToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  ApprovalStatus,
  Permission,
  PolicyApproval,
  PolicyApprovalVote,
  PolicyDecision
} from '../../../packages/contracts/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import {
  policyApprovals,
  policyApprovalVotes,
  policyDecisions,
  rolePermissions as rolePermissionTable,
  userRoles
} from '../../../packages/db/src/schema.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  createInternalFetcher,
  fetchReadyState,
  internalRequestHeaders,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import { decidePermission } from '../../../packages/policy/src/index.ts'
import {
  currentTraceId,
  initTelemetry,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/public-types.ts'
import { createPolicyApp, type PolicyAuthorizeInput } from './app.ts'
import {
  type ApprovalDeps,
  type ApprovalStore,
  createApprovalRoutes,
  createInternalApprovalRoutes
} from './approvals.ts'

initTelemetry('m-policy')

const { db, client } = createDb()
// M-Policy 通过内部 Eden client 发布事件，保持同步授权边界和异步事件边界分离。
const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), {
  fetcher: createInternalFetcher()
})

/**
 * 权限查询统一从 RBAC 权威表读取，避免服务实例内缓存导致授权事实与数据库漂移。
 */
async function permissionsForActor(actor: ActorId): Promise<Permission[]> {
  const rows = await db
    .select({ permissionId: rolePermissionTable.permissionId })
    .from(userRoles)
    .innerJoin(rolePermissionTable, eq(userRoles.roleId, rolePermissionTable.roleId))
    .where(eq(userRoles.userId, actor))

  return rows.map(row => row.permissionId as Permission)
}

/**
 * authorize 负责生成、持久化并发布完整决策事实；Core 不直接写 policy_decisions。
 */
async function authorize(input: PolicyAuthorizeInput): Promise<PolicyDecision> {
  const draft = decidePermission({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    permissions: await permissionsForActor(input.actor)
  })
  const decision: PolicyDecision = {
    ...draft,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  }

  await db.insert(policyDecisions).values({
    id: decision.id,
    actor: decision.actor,
    action: decision.action,
    resource: decision.resource,
    result: decision.result,
    reasons: decision.reasons,
    createdAt: new Date(decision.createdAt)
  })

  const traceId = input.traceId ?? currentTraceId()
  const event = createEventEnvelope({
    type: 'policy.decision.created',
    source: 'm-policy',
    payload: {
      decisionId: decision.id,
      actor: decision.actor,
      action: decision.action,
      resource: decision.resource,
      result: decision.result,
      reasons: decision.reasons
    },
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(traceId ? { traceId } : {})
  })
  const publish = await eventBus.internal.v0.publish.post({
    subject: 'policy.decision.created.v0',
    event
  })
  if (publish.error || !publish.data) {
    throw new Error('failed to publish policy.decision.created.v0')
  }

  return decision
}

/**
 * 决策查询保持纯读取路径，供 Core、CLI 和审计场景按 id 追溯历史授权结论。
 */
async function getDecision(id: string): Promise<PolicyDecision | null> {
  const rows = await db.select().from(policyDecisions).where(eq(policyDecisions.id, id)).limit(1)
  const row = rows[0]
  return row
    ? {
        id: row.id,
        actor: row.actor as ActorId,
        action: row.action as Permission,
        resource: row.resource,
        result: row.result as PolicyDecision['result'],
        reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
        createdAt: row.createdAt.toISOString()
      }
    : null
}

/**
 * PostgreSQL adapter for policy_approvals 和 policy_approval_votes；
 * 审批状态和投票记录的唯一权威写路径。
 */
const approvalStore: ApprovalStore = {
  async createApproval(input) {
    const now = new Date()
    const row = {
      id: crypto.randomUUID(),
      policyDecisionId: input.policyDecisionId,
      originService: input.originService,
      operationId: input.operationId,
      requestedBy: input.requestedBy,
      requiredAction: input.requiredAction,
      status: 'pending',
      quorumRequired: input.quorumRequired,
      expiresAt: new Date(input.expiresAt),
      createdAt: now,
      updatedAt: now
    }
    await db.insert(policyApprovals).values(row)
    return {
      id: row.id,
      policyDecisionId: row.policyDecisionId,
      originService: row.originService as PolicyApproval['originService'],
      operationId: row.operationId,
      requestedBy: row.requestedBy as ActorId,
      requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
      status: row.status as ApprovalStatus,
      quorumRequired: row.quorumRequired,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }
  },
  async listApprovals(status) {
    const query = status
      ? db.select().from(policyApprovals).where(eq(policyApprovals.status, status))
      : db.select().from(policyApprovals)
    const rows = await query
    return rows.map(row => ({
      id: row.id,
      policyDecisionId: row.policyDecisionId,
      originService: row.originService as PolicyApproval['originService'],
      operationId: row.operationId,
      requestedBy: row.requestedBy as ActorId,
      requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
      status: row.status as ApprovalStatus,
      quorumRequired: row.quorumRequired,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {})
    }))
  },
  async getApproval(id) {
    const [row] = await db.select().from(policyApprovals).where(eq(policyApprovals.id, id)).limit(1)
    if (!row) return null
    return {
      id: row.id,
      policyDecisionId: row.policyDecisionId,
      originService: row.originService as PolicyApproval['originService'],
      operationId: row.operationId,
      requestedBy: row.requestedBy as ActorId,
      requiredAction: row.requiredAction as PolicyApproval['requiredAction'],
      status: row.status as ApprovalStatus,
      quorumRequired: row.quorumRequired,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {})
    }
  },
  async getVotes(approvalId) {
    const rows = await db
      .select()
      .from(policyApprovalVotes)
      .where(eq(policyApprovalVotes.approvalId, approvalId))
    return rows.map(row => ({
      id: row.id,
      approvalId: row.approvalId,
      actor: row.actor as ActorId,
      vote: row.vote as PolicyApprovalVote['vote'],
      ...(row.reason ? { reason: row.reason } : {}),
      createdAt: row.createdAt.toISOString()
    }))
  },
  async addVote(approvalId, actor, vote, reason) {
    const row = {
      id: crypto.randomUUID(),
      approvalId,
      actor,
      vote,
      reason: reason ?? null,
      createdAt: new Date()
    }
    await db.insert(policyApprovalVotes).values(row)
    return {
      id: row.id,
      approvalId,
      actor,
      vote,
      ...(reason ? { reason } : {}),
      createdAt: row.createdAt.toISOString()
    }
  },
  async updateApprovalStatus(id, status, completedAt) {
    const now = new Date()
    await db
      .update(policyApprovals)
      .set({
        status,
        updatedAt: now,
        ...(completedAt ? { completedAt: new Date(completedAt) } : {})
      })
      .where(eq(policyApprovals.id, id))
    return this.getApproval(id)
  }
}

const approvalDeps: ApprovalDeps = {
  auth: {
    async verify(token) {
      const secret = process.env.MERISTEM_JWT_SECRET
      if (!secret)
        return {
          ok: false as const,
          code: 'auth.unconfigured',
          message: 'MERISTEM_JWT_SECRET is required'
        }
      const result = await verifyLocalToken({ token, secret })
      if (!result.ok) return { ok: false as const, code: result.code, message: result.message }
      return { ok: true as const, actor: result.actor }
    }
  },
  approvals: approvalStore,
  log: {
    async writeTimeline(input) {
      const traceId = currentTraceId()
      const event = createEventEnvelope({
        type: 'log.timeline',
        source: 'm-policy',
        payload: input,
        ...(traceId ? { traceId } : {})
      })
      await eventBus.internal.v0.publish.post({ subject: 'log.timeline.v0', event })
    },
    async writeFull(input) {
      const traceId = currentTraceId()
      const event = createEventEnvelope({
        type: 'log.full',
        source: 'm-policy',
        payload: input,
        ...(traceId ? { traceId } : {})
      })
      await eventBus.internal.v0.publish.post({ subject: 'log.full.v0', event })
    },
    async writeAudit(input) {
      const traceId = currentTraceId()
      const event = createEventEnvelope({
        type: 'audit.entry.created',
        source: 'm-policy',
        payload: input,
        ...(traceId ? { traceId } : {})
      })
      await eventBus.internal.v0.publish.post({ subject: 'audit.entry.created.v0', event })
    }
  },
  events: {
    async publish(subject, payload) {
      const event = createEventEnvelope({
        type: subject.replace(/\.v0$/, ''),
        source: 'm-policy',
        payload
      })
      await eventBus.internal.v0.publish.post({ subject, event })
    }
  },
  async authorize(actor, permission, resource) {
    const decision = decidePermission({
      actor,
      action: permission,
      resource,
      permissions: await permissionsForActor(actor)
    })
    return decision.result === 'allow'
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
    } else {
      const response = await fetch(
        `${serviceUrl('m-task')}/internal/v0/task-operations/${approval.operationId}/resume`,
        {
          method: 'POST',
          headers: internalRequestHeaders()
        }
      )
      if (!response.ok) throw new Error('m-task resume failed')
    }
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
    } else {
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

const approvalRoutes = createApprovalRoutes(approvalDeps)
const internalApprovalRoutes = createInternalApprovalRoutes(approvalDeps)

/**
 * 就绪探针把依赖异常收敛为 false，但必须保留可观测的降级原因。
 */
function warnReadinessFallback(dependency: string, error: unknown): false {
  console.warn(
    `m-policy: ${dependency} readiness probe degraded - ${error instanceof Error ? error.message : String(error)}`
  )
  return false
}

const app = createPolicyApp({
  async readiness() {
    const postgresReady = await client`select 1`
      .then(() => true)
      .catch(error => warnReadinessFallback('postgres', error))
    const eventBusReady = await fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    return { ready: postgresReady && eventBusReady }
  },
  authorize,
  getDecision
})

const mergedApp = app.use(approvalRoutes).use(internalApprovalRoutes)
const server = serveHttpApp('m-policy', mergedApp.fetch)

// 退出顺序先停 HTTP，再关数据库和 telemetry，避免正在处理的授权请求半途丢失。
process.on('SIGINT', () => {
  void server
    .stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-policy listening on http://127.0.0.1:${internalServicePorts['m-policy']}`)
