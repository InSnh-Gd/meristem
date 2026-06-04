import { beforeEach, describe, expect, it, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { mnetNetworkProfileStates, mnetProfileTransitions, networks } from '../../packages/db/src/schema.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
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
    async listMembers() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    suspendedOps,
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
    }
  })

  return { app, suspendedOps }
}

describe('integration: m-net multi-network profile lifecycle', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('covers enable -> approval resume -> disable across two networks and records transitions', async () => {
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

    await profileStore.setNetworkState(networkA, { profileVersion: 'm-net-default@0.1.0', status: 'disabled' })
    await profileStore.setNetworkState(networkB, { profileVersion: 'm-net-default@0.1.0', status: 'disabled' })

    const enableResponse = await app.handle(new Request(`http://localhost/api/v0/networks/${networkA}/profile`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'm-net-cn profile integration enable' })
    }))

    expect(enableResponse.status).toBe(200)
    const enableBody = await enableResponse.json() as {
      status: 'pending_approval'
      operationId: string
      correlationId: string
      approvalId?: string
    }
    expect(enableBody.status).toBe('pending_approval')
    expect(enableBody.operationId).toBeString()
    expect(enableBody.approvalId).toBeString()

    const stateAEnabling = await profileStore.getNetworkState(networkA)
    const stateBUntouched = await profileStore.getNetworkState(networkB)
    expect(stateAEnabling?.status).toBe('enabling')
    expect(stateAEnabling?.profileVersion).toBe('m-net-default@0.1.0')
    expect(stateBUntouched?.status).toBe('disabled')
    expect(stateBUntouched?.profileVersion).toBe('m-net-default@0.1.0')

    const suspended = await suspendedOps.get(enableBody.operationId)
    expect(suspended?.status).toBe('suspended')

    const resumeResponse = await app.handle(new Request(
      `http://localhost/internal/v0/network-profile-operations/${enableBody.operationId}/resume`,
      { method: 'POST', headers: internalHeaders() }
    ))

    expect(resumeResponse.status).toBe(200)
    const resumedStateA = await profileStore.getNetworkState(networkA)
    expect(resumedStateA?.status).toBe('enabled')
    expect(resumedStateA?.profileVersion).toBe('m-net-cn@0.1.0')

    const disableResponse = await app.handle(new Request(`http://localhost/api/v0/networks/${networkA}/profile`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ profileVersion: 'm-net-default@0.1.0', reason: 'm-net-default profile integration disable' })
    }))

    expect(disableResponse.status).toBe(200)
    const disableBody = await disableResponse.json() as { status: string; profileVersion: string }
    expect(disableBody.status).toBe('disabled')
    expect(disableBody.profileVersion).toBe('m-net-default@0.1.0')

    const disabledStateA = await profileStore.getNetworkState(networkA)
    expect(disabledStateA?.status).toBe('disabled')
    expect(disabledStateA?.profileVersion).toBe('m-net-default@0.1.0')

    expect(transitions).toHaveLength(3)
    expect(transitions[0]).toMatchObject({
      networkId: networkA,
      fromStatus: 'disabled',
      toStatus: 'enabling',
      fromVersion: 'm-net-default@0.1.0',
      toVersion: 'm-net-cn@0.1.0'
    })
    expect(transitions[1]).toMatchObject({
      networkId: networkA,
      fromStatus: 'enabling',
      toStatus: 'enabled',
      fromVersion: 'm-net-default@0.1.0',
      toVersion: 'm-net-cn@0.1.0'
    })
    expect(transitions[2]).toMatchObject({
      networkId: networkA,
      fromStatus: 'enabled',
      toStatus: 'disabled',
      fromVersion: 'm-net-cn@0.1.0',
      toVersion: 'm-net-default@0.1.0'
    })
  })
})

describe('integration: m-net profile PostgreSQL persistence smoke', () => {
  test.skipIf(!pgAvailable)('persists profile state and transition records in PostgreSQL tables', async () => {
    await import('../../packages/db/src/migrate.ts')
    const { db, client } = createDb()
    const now = new Date()
    const networkId = `mnet-int-db-${crypto.randomUUID()}`

    try {
      await db.insert(networks).values({
        id: networkId,
        name: `mnet-int-db-${Date.now()}`,
        profileVersion: 'm-net-default@0.1.0',
        status: 'active',
        createdAt: now,
        updatedAt: now
      })

      await db.insert(mnetNetworkProfileStates).values({
        networkId,
        profileVersion: 'm-net-default@0.1.0',
        status: 'disabled',
        updatedAt: now
      })

      await db.insert(mnetProfileTransitions).values({
        id: crypto.randomUUID(),
        networkId,
        fromProfileVersion: 'm-net-default@0.1.0',
        toProfileVersion: 'm-net-cn@0.1.0',
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
      expect(persistedState?.profileVersion).toBe('m-net-default@0.1.0')
      expect(persistedState?.status).toBe('disabled')

      const persistedTransitions = await db
        .select()
        .from(mnetProfileTransitions)
        .where(eq(mnetProfileTransitions.networkId, networkId))
      expect(persistedTransitions.length).toBeGreaterThanOrEqual(1)
      expect(persistedTransitions[0]?.toStatus).toBe('enabling')
    } finally {
      await db.delete(mnetProfileTransitions).where(eq(mnetProfileTransitions.networkId, networkId))
      await db.delete(mnetNetworkProfileStates).where(eq(mnetNetworkProfileStates.networkId, networkId))
      await db.delete(networks).where(and(eq(networks.id, networkId), eq(networks.profileVersion, 'm-net-default@0.1.0')))
      await client.end()
    }
  })

  test.skipIf(pgAvailable)('skipped: PostgreSQL unavailable, run docker compose up -d postgres', () => {
    expect(pgAvailable).toBe(false)
  })
})
