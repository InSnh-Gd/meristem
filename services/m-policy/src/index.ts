import { connect } from '@nats-io/transport-node'
import { eq } from 'drizzle-orm'
import { createDb } from '../../../packages/db/src/client.ts'
import { policyDecisions, rolePermissions as rolePermissionTable, userRoles } from '../../../packages/db/src/schema.ts'
import { decidePermission } from '../../../packages/policy/src/index.ts'
import { serveJsonRequests, subjects } from '../../../packages/nats-rpc/src/index.ts'
import type { ActorId, Permission, PolicyDecision } from '../../../packages/contracts/src/index.ts'

type AuthorizeRequest = {
  actor: ActorId
  action: Permission
  resource: string
  correlationId?: string
}

type AuthorizeResponse = {
  ok: true
  decision: PolicyDecision
}

type GetDecisionRequest = {
  id: string
}

const { db, client } = createDb()
const nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' })

async function permissionsForActor(actor: ActorId): Promise<Permission[]> {
  const rows = await db
    .select({ permissionId: rolePermissionTable.permissionId })
    .from(userRoles)
    .innerJoin(rolePermissionTable, eq(userRoles.roleId, rolePermissionTable.roleId))
    .where(eq(userRoles.userId, actor))

  return rows.map((row) => row.permissionId as Permission)
}

void serveJsonRequests<AuthorizeRequest, AuthorizeResponse>(nc, subjects.policyAuthorize, async (request) => {
  const draft = decidePermission({
    actor: request.actor,
    action: request.action,
    resource: request.resource,
    permissions: await permissionsForActor(request.actor)
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

  return { ok: true, decision }
})

void serveJsonRequests<GetDecisionRequest, { ok: true; decision: PolicyDecision | null }>(
  nc,
  subjects.policyDecisionGet,
  async (request) => {
    const rows = await db.select().from(policyDecisions).where(eq(policyDecisions.id, request.id)).limit(1)
    const row = rows[0]
    return {
      ok: true,
      decision: row
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
  }
)

process.on('SIGINT', () => {
  void nc.drain().then(() => client.end()).then(() => process.exit(0))
})

console.log(`m-policy listening on ${subjects.policyAuthorize}`)
