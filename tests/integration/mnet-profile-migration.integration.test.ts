import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { networks, policyDecisions } from '../../packages/db/src/schema.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createPgDataPlaneStores } from '../../services/m-net/src/data-plane-store-pg.ts'
import { createPgGlobalDefaultsStore } from '../../services/m-net/src/global-defaults-store-pg.ts'
import { createWiredMigrationEngine } from '../../services/m-net/src/migration-engine-factory.ts'
import { createPgProfileStore } from '../../services/m-net/src/profile-store.ts'

const jwtSecret = 'test-jwt-secret'
const internalToken = 'internal-test-token'
const fixedPolicyDecisionId = 'pd-mnet-migration'

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

let pgMigrated = false

type LogRecord = {
  kind: 'timeline' | 'full' | 'audit'
  payload: Record<string, unknown>
}

type PublishedEvent = {
  subject: string
  type: string
  payload: unknown
  correlationId?: string
}

type ListedMember = {
  networkId: string
  nodeId: string
  nodeKind: 'stem' | 'leaf'
  membershipMode: 'full'
  status: 'joined'
  joinedAt: string
}

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function mintAdminToken(): Promise<string> {
  return mintLocalToken({ actor: 'admin', secret: jwtSecret })
}

async function ensurePgSchema(): Promise<void> {
  if (!pgAvailable || pgMigrated) return
  await import('../../packages/db/src/migrate.ts')
  pgMigrated = true
}

async function resetPgState(): Promise<void> {
  const client = createSqlClient()
  await client`
    truncate table
      mnet_partition_states,
      mnet_data_plane_operation_locks,
      mnet_relay_assignments,
      mnet_tunnel_address_allocations,
      mnet_node_public_keys,
      mnet_network_map_renders,
      mnet_profile_migrations,
      mnet_profile_default_set_results,
      mnet_profile_switch_snapshots,
      mnet_profile_switch_results,
      mnet_profile_switch_batch_members,
      mnet_profile_switch_batches,
      mnet_profile_switch_operations,
      mnet_global_defaults,
      mnet_profile_transitions,
      mnet_network_profile_states,
      mnet_profile_definitions,
      policy_decisions,
      networks
    restart identity cascade
  `
  await client.end()
}

async function insertNetwork(id: string, profileVersion: string): Promise<void> {
  const { db, client } = createDb()
  const now = new Date()
  try {
    await db.insert(networks).values({
      id,
      name: id,
      profileVersion,
      status: 'active',
      createdAt: now,
      updatedAt: now
    })
  } finally {
    await client.end()
  }
}

async function insertPolicyDecision(): Promise<void> {
  const { db, client } = createDb()
  try {
    await db.insert(policyDecisions).values({
      id: fixedPolicyDecisionId,
      actor: 'admin',
      action: 'network:profile-switch-plan',
      resource: 'network:profile-switches',
      result: 'allow',
      reasons: [],
      createdAt: new Date()
    })
  } finally {
    await client.end()
  }
}

function createFixture(listedMembers: Record<string, ListedMember[]>) {
  const { db, client } = createDb()
  const profileStore = createPgProfileStore(db)
  const globalDefaultsStore = createPgGlobalDefaultsStore(db, profileStore)
  const dataPlaneStores = createPgDataPlaneStores(db)
  const logs: LogRecord[] = []
  const events: PublishedEvent[] = []
  const migrationEngine = createWiredMigrationEngine({
    globalDefaultsStore,
    profileStore,
    dataPlaneStores,
    log: {
      async writeTimeline(summary, subject, correlationId) {
        logs.push({ kind: 'timeline', payload: { summary, subject, correlationId } })
      },
      async writeFull(level, message, correlationId, payload) {
        logs.push({ kind: 'full', payload: { level, message, correlationId, payload } })
      },
      async writeAudit(actor, action, resource, result, correlationId, payload) {
        logs.push({
          kind: 'audit',
          payload: { actor, action, resource, result, correlationId, payload }
        })
      }
    },
    async listMembers(input) {
      return { ok: true, value: listedMembers[input.networkId] ?? [] }
    }
  })
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
      return { ok: true, value: listedMembers[input.networkId] ?? [] }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    globalDefaultsStore,
    migrationEngine,
    policyAuthorize: {
      async authorize() {
        return { result: 'allow' as const, id: fixedPolicyDecisionId, reasons: [] }
      }
    },
    log: {
      async writeTimeline(summary, subject, correlationId) {
        logs.push({ kind: 'timeline', payload: { summary, subject, correlationId } })
      },
      async writeFull(level, message, correlationId, payload) {
        logs.push({ kind: 'full', payload: { level, message, correlationId, payload } })
      },
      async writeAudit(actor, action, resource, result, correlationId, payload) {
        logs.push({
          kind: 'audit',
          payload: { actor, action, resource, result, correlationId, payload }
        })
      }
    },
    events: {
      async publish(subject, type, payload, correlationId) {
        events.push(
          correlationId === undefined
            ? { subject, type, payload }
            : { subject, type, payload, correlationId }
        )
      }
    }
  })

  return { app, client, profileStore, globalDefaultsStore, dataPlaneStores, logs, events }
}

describe('integration: m-net profile migration workflows', () => {
  beforeAll(async () => {
    if (!pgAvailable) return
    await ensurePgSchema()
  })

  beforeEach(async () => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
    if (!pgAvailable) return
    await resetPgState()
    await insertPolicyDecision()
  })

  test.skipIf(!pgAvailable)(
    'dry-run lists exact affected networks and apply/rollback persists migration state',
    async () => {
      await insertNetwork('net-cn-legacy', 'm-net-cn@0.1.0')
      await insertNetwork('net-default-stable', 'm-net-default@0.1.0')
      await insertNetwork('net-cn-current', 'm-net-cn@0.2.0')

      const fixture = createFixture({
        'net-cn-legacy': [
          {
            networkId: 'net-cn-legacy',
            nodeId: 'stem-cn-1',
            nodeKind: 'stem',
            membershipMode: 'full',
            status: 'joined',
            joinedAt: '2026-06-18T00:00:00.000Z'
          }
        ]
      })
      const token = await mintAdminToken()

      try {
        await fixture.profileStore.setNetworkState('net-cn-legacy', {
          profileVersion: 'm-net-cn@0.1.0',
          status: 'disabled'
        })
        await fixture.profileStore.setNetworkState('net-default-stable', {
          profileVersion: 'm-net-default@0.1.0',
          status: 'disabled'
        })
        await fixture.profileStore.setNetworkState('net-cn-current', {
          profileVersion: 'm-net-cn@0.3.0',
          status: 'enabled'
        })

        const planResponse = await fixture.app.handle(
          new Request('http://localhost/api/v0/networks/profile-switches/plan', {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              targetProfileVersion: 'm-net-cn@0.3.0',
              batchSize: 1,
              reason: 'dry-run exact legacy CN migration',
              idempotencyKey: 'idem-dry-run-1'
            })
          })
        )
        expect(planResponse.status).toBe(200)
        const planBody = (await planResponse.json()) as {
          operationId: string
          candidateCount: number
          candidates: string[]
          batches: Array<{ batchId: number; networkIds: string[] }>
        }
        expect(planBody.candidateCount).toBe(1)
        expect(planBody.candidates).toEqual(['net-cn-legacy'])
        expect(planBody.batches).toEqual([{ batchId: 1, networkIds: ['net-cn-legacy'] }])

        const applyResponse = await fixture.app.handle(
          new Request(
            `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
            {
              method: 'POST',
              headers: bearerHeaders(token),
              body: JSON.stringify({})
            }
          )
        )
        expect(applyResponse.status).toBe(200)
        const applyBody = (await applyResponse.json()) as {
          batchId: number
          results: Array<{ networkId: string; status: string }>
          globalSwitchState: 'applied' | 'applying'
        }
        expect(applyBody.batchId).toBe(1)
        expect(applyBody.results).toEqual([
          expect.objectContaining({ networkId: 'net-cn-legacy', status: 'applied' })
        ])
        expect((await fixture.profileStore.getNetworkState('net-cn-legacy'))?.profileVersion).toBe(
          'm-net-cn@0.3.0'
        )
        expect(
          (
            await fixture.dataPlaneStores.profileMigrations.get(
              'net-cn-legacy',
              planBody.operationId
            )
          )?.status
        ).toBe('applied')
        expect(
          fixture.logs.some(
            record =>
              record.kind === 'audit' &&
              record.payload.action === 'mnet.profile.migration.plan' &&
              record.payload.result === 'applied'
          )
        ).toBe(true)
        expect(
          fixture.logs.some(
            record =>
              record.kind === 'timeline' &&
              record.payload.subject === 'mnet.profile.migration.applied'
          )
        ).toBe(true)

        const rollbackResponse = await fixture.app.handle(
          new Request(
            `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/rollback`,
            {
              method: 'POST',
              headers: bearerHeaders(token),
              body: JSON.stringify({
                reason: 'operator rollback before compatibility window closes'
              })
            }
          )
        )
        expect(rollbackResponse.status).toBe(200)
        const rollbackBody = (await rollbackResponse.json()) as {
          rollbackResults: Array<{ networkId: string; status: string }>
          globalSwitchState: string
        }
        expect(rollbackBody.globalSwitchState).toBe('rolled_back')
        expect(rollbackBody.rollbackResults).toEqual([
          expect.objectContaining({ networkId: 'net-cn-legacy', status: 'rolled_back' })
        ])
        expect((await fixture.profileStore.getNetworkState('net-cn-legacy'))?.profileVersion).toBe(
          'm-net-cn@0.1.0'
        )
      } finally {
        await fixture.client.end()
      }
    }
  )

  test.skipIf(!pgAvailable)(
    'setting production global defaults auto-migrates legacy CN networks and returns migration operation id',
    async () => {
      await insertNetwork('net-cn-defaults', 'm-net-cn@0.1.0')

      const fixture = createFixture({
        'net-cn-defaults': [
          {
            networkId: 'net-cn-defaults',
            nodeId: 'stem-cn-2',
            nodeKind: 'stem',
            membershipMode: 'full',
            status: 'joined',
            joinedAt: '2026-06-18T00:00:00.000Z'
          }
        ]
      })
      const token = await mintAdminToken()

      try {
        await fixture.profileStore.setNetworkState('net-cn-defaults', {
          profileVersion: 'm-net-cn@0.1.0',
          status: 'disabled'
        })

        const response = await fixture.app.handle(
          new Request('http://localhost/api/v0/networks/profile-defaults', {
            method: 'PUT',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              profileVersion: 'm-net-cn@0.3.0',
              reason: 'promote production data-plane defaults',
              idempotencyKey: 'idem-defaults-1'
            })
          })
        )
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          defaultProfileVersion: string
          migrationOperationId?: string
        }
        expect(body.defaultProfileVersion).toBe('m-net-cn@0.3.0')
        expect(body.migrationOperationId).toBeString()
        expect(await fixture.globalDefaultsStore.getDefaultProfileVersion()).toBe('m-net-cn@0.3.0')
        expect(
          (await fixture.profileStore.getNetworkState('net-cn-defaults'))?.profileVersion
        ).toBe('m-net-cn@0.3.0')
        expect(
          fixture.events.some(
            event =>
              event.subject === 'mnet.profile.defaults.updated.v0' &&
              typeof event.payload === 'object' &&
              event.payload !== null &&
              'migrationOperationId' in event.payload
          )
        ).toBe(true)
      } finally {
        await fixture.client.end()
      }
    }
  )

  test.skipIf(!pgAvailable)(
    'offline leaf migration persists applied result while retaining stale partition evidence for follow-up',
    async () => {
      await insertNetwork('net-cn-offline', 'm-net-cn@0.1.0')

      const fixture = createFixture({
        'net-cn-offline': [
          {
            networkId: 'net-cn-offline',
            nodeId: 'leaf-cn-offline-1',
            nodeKind: 'leaf',
            membershipMode: 'full',
            status: 'joined',
            joinedAt: '2026-06-18T00:00:00.000Z'
          }
        ]
      })
      const token = await mintAdminToken()

      try {
        await fixture.profileStore.setNetworkState('net-cn-offline', {
          profileVersion: 'm-net-cn@0.1.0',
          status: 'disabled'
        })
        await fixture.dataPlaneStores.partitionStates.upsert({
          networkId: 'net-cn-offline',
          state: 'stale',
          reason: { code: 'network_map.stale', staleForMs: 60_000 },
          transitionedAt: '2026-06-18T00:00:00.000Z',
          previousState: 'connected'
        })

        const planResponse = await fixture.app.handle(
          new Request('http://localhost/api/v0/networks/profile-switches/plan', {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              reason: 'offline leaf migration rehearsal',
              idempotencyKey: 'idem-offline-1'
            })
          })
        )
        const planBody = (await planResponse.json()) as { operationId: string }

        const applyResponse = await fixture.app.handle(
          new Request(
            `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
            {
              method: 'POST',
              headers: bearerHeaders(token),
              body: JSON.stringify({})
            }
          )
        )
        expect(applyResponse.status).toBe(200)
        const applyBody = (await applyResponse.json()) as {
          results: Array<{
            networkId: string
            status: string
            previousProfileVersion?: string
            targetProfileVersion?: string
            correlationId?: string
            auditId?: string
          }>
        }
        expect(applyBody.results).toEqual([
          expect.objectContaining({
            networkId: 'net-cn-offline',
            status: 'pending',
            previousProfileVersion: 'm-net-cn@0.1.0',
            targetProfileVersion: 'm-net-cn@0.3.0',
            reason: 'offline leaf members require follow-up before migration can complete'
          })
        ])
        expect(
          (
            await fixture.dataPlaneStores.profileMigrations.get(
              'net-cn-offline',
              planBody.operationId
            )
          )?.status
        ).toBe('pending')
      } finally {
        await fixture.client.end()
      }
    }
  )

  test.skipIf(pgAvailable)('skips gracefully when PostgreSQL is unavailable', () => {
    expect(pgAvailable).toBe(false)
  })
})
