import { beforeEach, describe, expect, it, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import {
  mnetNetworkProfileStates,
  mnetProfileTransitions,
  networks
} from '../../packages/db/src/schema.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import {
  createInMemoryProfileStore,
  type ProfileStore,
  type ProfileTransitionRecord
} from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

const jwtSecret = 'test-jwt-secret'
const internalToken = 'internal-test-token'

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

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

function internalHeaders(): Record<string, string> {
  return { 'x-meristem-internal-token': internalToken }
}

async function mintTestToken(): Promise<string> {
  return mintLocalToken({ actor: 'admin', secret: jwtSecret })
}

function createIntegrationApp(profileStore: ProfileStore) {
  const suspendedOps = createInMemorySuspendedOperationStore()
  const dataPlane = createInMemoryDataPlaneStores()
  const app = createMNetApp({
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listMembers(input) {
      return {
        ok: true,
        value: [
          {
            networkId: input.networkId,
            nodeId: `stem-${input.networkId}`,
            nodeKind: 'stem' as const,
            membershipMode: 'full' as const,
            status: 'joined' as const,
            joinedAt: new Date().toISOString()
          }
        ]
      }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    suspendedOps,
    dataPlane,
    policyAuthorize: {
      async authorize(_actor, action, _resource) {
        if (action === 'network:profile-disable') {
          return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
        }
        return { result: 'require_manual_review' as const, id: crypto.randomUUID(), reasons: [] }
      }
    },
    approvals: {
      async create() {
        return { ok: true as const, value: { approvalId: crypto.randomUUID() } }
      }
    },
    events: {
      async publish() {
        /* no-op for integration fixture */
      }
    },
    log: {
      async writeTimeline() {
        /* no-op for integration fixture */
      },
      async writeFull() {
        /* no-op for integration fixture */
      },
      async writeAudit() {
        /* no-op for integration fixture */
      }
    }
  })

  return { app, suspendedOps }
}

describe('integration: m-net multi-network profile lifecycle', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('returns typed migration guidance for legacy CN profile enable requests and leaves other networks unchanged', async () => {
    const baseStore = createInMemoryProfileStore()
    const transitions: ProfileTransitionRecord[] = []
    const profileStore: ProfileStore = {
      ...baseStore,
      async recordTransition(record) {
        transitions.push(record)
        await baseStore.recordTransition(record)
      }
    }

    const { app, suspendedOps } = createIntegrationApp(profileStore)
    const token = await mintTestToken()

    const networkA = `mnet-int-a-${crypto.randomUUID()}`
    const networkB = `mnet-int-b-${crypto.randomUUID()}`

    await profileStore.setNetworkState(networkA, {
      profileVersion: 'm-net-cn@0.2.0',
      status: 'disabled'
    })
    await profileStore.setNetworkState(networkB, {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    const enableResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkA}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.3.0',
          reason: 'm-net-cn profile integration enable'
        })
      })
    )

    expect(enableResponse.status).toBe(409)
    const enableBody = (await enableResponse.json()) as {
      error: {
        code: 'migration_required'
        message: string
        migration: {
          reasonCode: string
          targetProfileVersion: string
        }
      }
    }
    expect(enableBody.error.code).toBe('migration_required')
    expect(enableBody.error.migration.reasonCode).toBe('legacy_wstunnel_profile_v0_2')
    expect(enableBody.error.migration.targetProfileVersion).toBe('m-net-cn@0.3.0')

    const stateAEnabling = await profileStore.getNetworkState(networkA)
    const stateBUntouched = await profileStore.getNetworkState(networkB)
    expect(stateAEnabling?.status).toBe('disabled')
    expect(stateAEnabling?.profileVersion).toBe('m-net-cn@0.2.0')
    expect(stateBUntouched?.status).toBe('disabled')
    expect(stateBUntouched?.profileVersion).toBe('m-net@0.3.0')
    expect(await suspendedOps.get(`unused-${networkA}`)).toBeNull()
    expect(transitions).toHaveLength(0)
  })
})

describe('integration: m-net profile PostgreSQL persistence smoke', () => {
  test.skipIf(!pgAvailable)(
    'persists profile state and transition records in PostgreSQL tables',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const { db, client } = createDb()
      const now = new Date()
      const networkId = `mnet-int-db-${crypto.randomUUID()}`

      try {
        await db.insert(networks).values({
          id: networkId,
          name: `mnet-int-db-${Date.now()}`,
          profileVersion: 'm-net@0.3.0',
          status: 'active',
          createdAt: now,
          updatedAt: now
        })

        await db.insert(mnetNetworkProfileStates).values({
          networkId,
          profileVersion: 'm-net@0.3.0',
          status: 'disabled',
          updatedAt: now
        })

        await db.insert(mnetProfileTransitions).values({
          id: crypto.randomUUID(),
          networkId,
          fromProfileVersion: 'm-net@0.3.0',
          toProfileVersion: 'm-net-cn@0.3.0',
          fromStatus: 'disabled',
          toStatus: 'enabling',
          actor: 'admin',
          reason: 'postgres persistence smoke',
          createdAt: now
        })

        const [persistedState] = await db
          .select()
          .from(mnetNetworkProfileStates)
          .where(eq(mnetNetworkProfileStates.networkId, networkId))
          .limit(1)
        expect(persistedState?.profileVersion).toBe('m-net@0.3.0')
        expect(persistedState?.status).toBe('disabled')

        const persistedTransitions = await db
          .select()
          .from(mnetProfileTransitions)
          .where(eq(mnetProfileTransitions.networkId, networkId))
        expect(persistedTransitions.length).toBeGreaterThanOrEqual(1)
        expect(persistedTransitions[0]?.toStatus).toBe('enabling')
      } finally {
        await db
          .delete(mnetProfileTransitions)
          .where(eq(mnetProfileTransitions.networkId, networkId))
        await db
          .delete(mnetNetworkProfileStates)
          .where(eq(mnetNetworkProfileStates.networkId, networkId))
        await db
          .delete(networks)
          .where(and(eq(networks.id, networkId), eq(networks.profileVersion, 'm-net@0.3.0')))
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
