import { edenTreaty } from '@elysiajs/eden'
import { eq } from 'drizzle-orm'
import { createDb } from '../../../packages/db/src/client.ts'
import { policyDecisions, rolePermissions as rolePermissionTable, userRoles } from '../../../packages/db/src/schema.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  createInternalFetcher,
  fetchReadyState,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import { decidePermission } from '../../../packages/policy/src/index.ts'
import type { ActorId, Permission, PolicyDecision } from '../../../packages/contracts/src/index.ts'
import { currentTraceId, initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { EventBusApp } from '../../m-eventbus/src/app.ts'
import { createPolicyApp, type PolicyAuthorizeInput } from './app.ts'

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

  return rows.map((row) => row.permissionId as Permission)
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

const app = createPolicyApp({
  async readiness() {
    const postgresReady = await client`select 1`
      .then(() => true)
      .catch(() => false)
    const eventBusReady = await fetchReadyState(`${serviceUrl('m-eventbus')}/ready`)
    return { ready: postgresReady && eventBusReady }
  },
  authorize,
  getDecision
})

const server = serveHttpApp('m-policy', app.fetch)

// 退出顺序先停 HTTP，再关数据库和 telemetry，避免正在处理的授权请求半途丢失。
process.on('SIGINT', () => {
  void server.stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-policy listening on http://127.0.0.1:${internalServicePorts['m-policy']}`)
