import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  extensionPermission,
  type MExtensionManifestV01,
  mExtensionManifestVersion
} from '../../packages/contracts/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import {
  extensionDefinitions,
  extensionInstances,
  extensionTransitions,
  policyDecisions
} from '../../packages/db/src/schema.ts'
import { createDbExtensionStore } from '../../services/m-extension/src/db-store.ts'

const pgAvailable = await (async () => {
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

const manifest: MExtensionManifestV01 = {
  id: `extension-db-${crypto.randomUUID()}`,
  manifestVersion: mExtensionManifestVersion,
  displayName: 'DB Extension',
  kind: 'metadata-only',
  owner: 'meristem',
  license: 'Apache-2.0',
  declaredCapabilities: ['metadata.registry'],
  requestedPermissions: [extensionPermission.read],
  riskClass: 'low',
  lifecycleStatus: 'active',
  controlPlaneOnly: true
}

describe('integration: m-extension PostgreSQL store', () => {
  test.skipIf(!pgAvailable)(
    'persists definitions, instances, and transitions in authoritative tables',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const { db, client } = createDb()
      const decisionId = `decision-extension-db-${crypto.randomUUID()}`
      const store = createDbExtensionStore(db)

      try {
        await db.insert(policyDecisions).values({
          id: decisionId,
          actor: 'admin',
          action: extensionPermission.register,
          resource: `extension:${manifest.id}`,
          result: 'allow',
          reasons: [],
          createdAt: new Date()
        })

        const registered = await store.register({
          manifest,
          actor: 'admin',
          policyDecisionId: decisionId,
          correlationId: 'corr-extension-db'
        })
        expect(registered.definition.id).toBe(manifest.id)
        expect(registered.instance.status).toBe('disabled')

        const reloaded = createDbExtensionStore(db)
        const persisted = await reloaded.get(manifest.id)
        expect(persisted?.definition.id).toBe(manifest.id)
        expect(persisted?.instance?.status).toBe('disabled')

        const enabled = await reloaded.enable({
          extensionId: manifest.id,
          actor: 'admin',
          policyDecisionId: decisionId,
          correlationId: 'corr-extension-db-enable'
        })
        expect(enabled?.instance.status).toBe('enabled')
        expect((await reloaded.transitions()).length).toBeGreaterThanOrEqual(2)
      } finally {
        await db
          .delete(extensionTransitions)
          .where(eq(extensionTransitions.extensionId, manifest.id))
        await db.delete(extensionInstances).where(eq(extensionInstances.extensionId, manifest.id))
        await db.delete(extensionDefinitions).where(eq(extensionDefinitions.id, manifest.id))
        await db.delete(policyDecisions).where(eq(policyDecisions.id, decisionId))
        await client.end()
      }
    }
  )

  test.skipIf(pgAvailable)(
    'skipped: PostgreSQL unavailable, run docker compose up -d postgres',
    () => {
      expect(pgAvailable).toBe(false)
    }
  )
})
