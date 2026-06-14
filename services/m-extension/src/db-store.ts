import { and, eq } from 'drizzle-orm'
import type {
  MExtensionDefinition,
  MExtensionInstance,
  MExtensionManifestV01,
  MExtensionTransition
} from '../../../packages/contracts/src/types/extension.ts'
import { mExtensionScope } from '../../../packages/contracts/src/types/extension.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  extensionDefinitions,
  extensionInstances,
  extensionTransitions
} from '../../../packages/db/src/schema.ts'
import type { ExtensionStore, InstanceTransitionInput, RegisterDefinitionInput } from './store.ts'

function asDefinition(row: typeof extensionDefinitions.$inferSelect): MExtensionDefinition {
  return {
    id: row.id,
    manifestVersion: row.manifestVersion as MExtensionDefinition['manifestVersion'],
    kind: row.kind as MExtensionDefinition['kind'],
    displayName: row.displayName,
    owner: row.owner,
    license: row.license,
    manifest: row.manifest as MExtensionManifestV01,
    declaredCapabilities: row.declaredCapabilities as string[],
    requestedPermissions: row.requestedPermissions as MExtensionDefinition['requestedPermissions'],
    riskClass: row.riskClass as MExtensionDefinition['riskClass'],
    status: row.status as MExtensionDefinition['status'],
    registeredBy: row.registeredBy as MExtensionDefinition['registeredBy'],
    policyDecisionId: row.policyDecisionId,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function asInstance(row: typeof extensionInstances.$inferSelect): MExtensionInstance {
  return {
    id: row.id,
    extensionId: row.extensionId,
    scopeType: row.scopeType as MExtensionInstance['scopeType'],
    scopeId: row.scopeId as MExtensionInstance['scopeId'],
    status: row.status as MExtensionInstance['status'],
    ...(row.enabledBy ? { enabledBy: row.enabledBy as MExtensionInstance['enabledBy'] } : {}),
    ...(row.disabledBy ? { disabledBy: row.disabledBy as MExtensionInstance['disabledBy'] } : {}),
    ...(row.policyDecisionId ? { policyDecisionId: row.policyDecisionId } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.enabledAt ? { enabledAt: row.enabledAt.toISOString() } : {}),
    ...(row.disabledAt ? { disabledAt: row.disabledAt.toISOString() } : {})
  }
}

function asTransition(row: typeof extensionTransitions.$inferSelect): MExtensionTransition {
  return {
    id: row.id,
    extensionId: row.extensionId,
    ...(row.instanceId ? { instanceId: row.instanceId } : {}),
    ...(row.fromStatus ? { fromStatus: row.fromStatus } : {}),
    toStatus: row.toStatus,
    actor: row.actor as MExtensionTransition['actor'],
    ...(row.reason ? { reason: row.reason } : {}),
    policyDecisionId: row.policyDecisionId,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString()
  }
}

async function pair(db: MeristemDb, definition: typeof extensionDefinitions.$inferSelect) {
  const [instance] = await db
    .select()
    .from(extensionInstances)
    .where(
      and(
        eq(extensionInstances.extensionId, definition.id),
        eq(extensionInstances.scopeType, mExtensionScope.type),
        eq(extensionInstances.scopeId, mExtensionScope.id)
      )
    )
    .limit(1)
  return instance
    ? { definition: asDefinition(definition), instance: asInstance(instance) }
    : { definition: asDefinition(definition) }
}

function transitionInsert(
  input: Omit<MExtensionTransition, 'id' | 'createdAt'>
): typeof extensionTransitions.$inferInsert {
  return {
    id: crypto.randomUUID(),
    extensionId: input.extensionId,
    instanceId: input.instanceId ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus,
    actor: input.actor,
    reason: input.reason ?? null,
    policyDecisionId: input.policyDecisionId,
    correlationId: input.correlationId,
    createdAt: new Date()
  }
}

export function createDbExtensionStore(db: MeristemDb): ExtensionStore {
  return {
    async list() {
      const rows = await db.select().from(extensionDefinitions)
      return Promise.all(rows.map(definition => pair(db, definition)))
    },
    async get(id) {
      const [definition] = await db
        .select()
        .from(extensionDefinitions)
        .where(eq(extensionDefinitions.id, id))
        .limit(1)
      return definition ? pair(db, definition) : null
    },
    async register(input: RegisterDefinitionInput) {
      const now = new Date()
      const current = await this.get(input.manifest.id)
      const definition = {
        id: input.manifest.id,
        manifestVersion: input.manifest.manifestVersion,
        kind: input.manifest.kind,
        displayName: input.manifest.displayName,
        owner: input.manifest.owner,
        license: input.manifest.license,
        manifest: input.manifest,
        declaredCapabilities: input.manifest.declaredCapabilities,
        requestedPermissions: input.manifest.requestedPermissions,
        riskClass: input.manifest.riskClass,
        status: 'registered',
        registeredBy: input.actor,
        policyDecisionId: input.policyDecisionId,
        correlationId: input.correlationId,
        createdAt: current ? new Date(current.definition.createdAt) : now,
        updatedAt: now
      } satisfies typeof extensionDefinitions.$inferInsert
      const instance = {
        id: crypto.randomUUID(),
        extensionId: input.manifest.id,
        scopeType: mExtensionScope.type,
        scopeId: mExtensionScope.id,
        status: 'disabled',
        createdAt: now,
        updatedAt: now
      } satisfies typeof extensionInstances.$inferInsert

      await db.transaction(async tx => {
        await tx
          .insert(extensionDefinitions)
          .values(definition)
          .onConflictDoUpdate({
            target: extensionDefinitions.id,
            set: { ...definition, updatedAt: now }
          })
        if (!current?.instance) await tx.insert(extensionInstances).values(instance)
        await tx.insert(extensionTransitions).values(
          transitionInsert({
            extensionId: input.manifest.id,
            toStatus: 'registered',
            actor: input.actor,
            policyDecisionId: input.policyDecisionId,
            correlationId: input.correlationId
          })
        )
      })
      const persisted = await this.get(input.manifest.id)
      return persisted?.instance
        ? { definition: persisted.definition, instance: persisted.instance }
        : {
            definition: asDefinition(definition),
            instance: asInstance({
              ...instance,
              enabledBy: null,
              disabledBy: null,
              policyDecisionId: null,
              correlationId: null,
              lastError: null,
              enabledAt: null,
              disabledAt: null
            })
          }
    },
    async enable(input: InstanceTransitionInput) {
      return transition(db, input, 'enabled')
    },
    async disable(input: InstanceTransitionInput) {
      return transition(db, input, 'disabled')
    },
    async transitions() {
      const rows = await db.select().from(extensionTransitions)
      return rows.map(asTransition)
    }
  }
}

async function transition(
  db: MeristemDb,
  input: InstanceTransitionInput,
  status: 'enabled' | 'disabled'
) {
  const current = await createDbExtensionStore(db).get(input.extensionId)
  if (!current?.instance) return null
  const instance = current.instance
  const now = new Date()
  const set =
    status === 'enabled'
      ? {
          status,
          enabledBy: input.actor,
          disabledBy: null,
          policyDecisionId: input.policyDecisionId,
          correlationId: input.correlationId,
          lastError: null,
          updatedAt: now,
          enabledAt: now
        }
      : {
          status,
          disabledBy: input.actor,
          enabledBy: null,
          policyDecisionId: input.policyDecisionId,
          correlationId: input.correlationId,
          lastError: null,
          updatedAt: now,
          disabledAt: now
        }
  await db.transaction(async tx => {
    await tx
      .update(extensionInstances)
      .set(set)
      .where(
        and(
          eq(extensionInstances.extensionId, input.extensionId),
          eq(extensionInstances.scopeType, mExtensionScope.type),
          eq(extensionInstances.scopeId, mExtensionScope.id)
        )
      )
    await tx.insert(extensionTransitions).values(
      transitionInsert({
        extensionId: input.extensionId,
        instanceId: instance.id,
        fromStatus: instance.status,
        toStatus: status,
        actor: input.actor,
        ...(input.reason ? { reason: input.reason } : {}),
        policyDecisionId: input.policyDecisionId,
        correlationId: input.correlationId
      })
    )
  })
  return createDbExtensionStore(db).get(input.extensionId) as Promise<{
    definition: MExtensionDefinition
    instance: MExtensionInstance
  } | null>
}
