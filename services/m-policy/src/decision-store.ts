import { desc, eq } from 'drizzle-orm'
import type { ActorId, Permission, PolicyDecision } from '../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { policyDecisions, rolePermissions as rolePermissionTable, userRoles } from '../../../packages/db/src/schema.ts'
import { decidePermission } from '../../../packages/policy/src/index.ts'
import type { PolicyEventPublisher } from './event-publisher.ts'

export async function permissionsForActor(db: MeristemDb, actor: ActorId): Promise<Permission[]> {
  const rows = await db
    .select({ permissionId: rolePermissionTable.permissionId })
    .from(userRoles)
    .innerJoin(rolePermissionTable, eq(userRoles.roleId, rolePermissionTable.roleId))
    .where(eq(userRoles.userId, actor))

  return rows.map(row => row.permissionId as Permission)
}

export function createPolicyDecisionStore(db: MeristemDb, publisher: PolicyEventPublisher) {
  return {
    async authorize(input: {
      actor: ActorId
      action: Permission
      resource: string
      correlationId?: string
      traceId?: string
    }): Promise<PolicyDecision> {
      const draft = decidePermission({
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        permissions: await permissionsForActor(db, input.actor)
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

      await publisher.publishDecisionCreated({
        decisionId: decision.id,
        actor: decision.actor,
        action: decision.action,
        resource: decision.resource,
        result: decision.result,
        reasons: decision.reasons,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.traceId ? { traceId: input.traceId } : {})
      })

      return decision
    },
    async getDecision(id: string): Promise<PolicyDecision | null> {
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
    },
    async listDecisions(): Promise<PolicyDecision[]> {
      const rows = await db.select().from(policyDecisions).orderBy(desc(policyDecisions.createdAt))
      return rows.map(row => ({
        id: row.id,
        actor: row.actor as ActorId,
        action: row.action as Permission,
        resource: row.resource,
        result: row.result as PolicyDecision['result'],
        reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
        createdAt: row.createdAt.toISOString()
      }))
    },
    async hasPermission(actor: ActorId, permission: Permission, resource: string): Promise<boolean> {
      const decision = decidePermission({
        actor,
        action: permission,
        resource,
        permissions: await permissionsForActor(db, actor)
      })
      return decision.result === 'allow'
    }
  }
}
