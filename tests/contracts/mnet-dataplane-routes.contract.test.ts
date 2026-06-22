import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import type { MNetworkMember } from '../../packages/contracts/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import type { DataPlaneStores } from '../../services/m-net/src/data-plane-store-types.ts'
import type { MNetAppDeps } from '../../services/m-net/src/deps.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

const jwtSecret = 'mnet-dataplane-jwt-secret'
const internalToken = 'mnet-dataplane-internal-token'

const members: MNetworkMember[] = [
  {
    networkId: 'network-dataplane-test',
    nodeId: 'stem-cn-1',
    nodeKind: 'stem',
    membershipMode: 'full',
    status: 'joined',
    joinedAt: '2026-06-18T00:00:00.000Z'
  },
  {
    networkId: 'network-dataplane-test',
    nodeId: 'leaf-cn-1',
    nodeKind: 'leaf',
    membershipMode: 'restricted',
    status: 'joined',
    joinedAt: '2026-06-18T00:01:00.000Z'
  }
]

type EventRecord = {
  subject: string
  type: string
  payload: unknown
  correlationId?: string | undefined
}

type LogRecord = { kind: 'timeline' | 'full' | 'audit'; payload: Record<string, unknown> }

type RouteFixture = {
  app: ReturnType<typeof createMNetApp>
  dataPlane: DataPlaneStores
  events: EventRecord[]
  logs: LogRecord[]
  profileStore: NonNullable<MNetAppDeps['profileStore']>
}

const nodeRuntimeToken = 'node-runtime-token'

function validKey(seed: string): string {
  return `${seed
    .replace(/[^A-Za-z0-9]/g, 'A')
    .padEnd(43, 'B')
    .slice(0, 43)}=`
}

async function mintToken(actor: 'admin' | 'security-admin'): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

function internalHeaders(): Record<string, string> {
  return {
    [internalTokenHeaderName]: internalToken,
    'content-type': 'application/json'
  }
}

function createRouteFixture(): RouteFixture {
  const dataPlane = createInMemoryDataPlaneStores()
  const profileStore = createInMemoryProfileStore()
  const suspendedOps = createInMemorySuspendedOperationStore()
  const events: EventRecord[] = []
  const logs: LogRecord[] = []

  const app = createMNetApp({
    dataPlane,
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listNetworks() {
      return { ok: true, value: [] }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listMembers(input) {
      return { ok: true, value: members.filter(member => member.networkId === input.networkId) }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    nodeRuntime: {
      async authorize(_nodeId, token) {
        return token === nodeRuntimeToken
      },
      async fetchLatestNetworkMap(_nodeId) {
        const latest = await dataPlane.networkMaps.getLatest('network-dataplane-test')
        return latest
          ? { map: latest.map }
          : {
              kind: 'failure' as const,
              status: 404 as const,
              error: { code: 'network_map.not_found', message: 'network map not found' }
            }
      },
      async registerNodePublicKey(input) {
        const mapVersion =
          (await dataPlane.networkMaps.getLatest('network-dataplane-test'))?.mapVersion ?? 0
        return {
          nodeId: input.nodeId,
          keyId: input.keyId,
          fingerprint: `wg:${input.publicKey.slice(0, 8)}`,
          mapVersion,
          correlationId: 'node-runtime-correlation'
        }
      }
    },
    profileStore,
    suspendedOps,
    approvals: {
      async create() {
        return { ok: true as const, value: { approvalId: crypto.randomUUID() } }
      }
    },
    policyAuthorize: {
      async authorize(_actor, _action, _resource) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    },
    networkUpdater: {
      async setProfileVersion() {
        /* noop */
      }
    },
    events: {
      async publish(subject, type, payload, correlationId) {
        events.push({ subject, type, payload, correlationId })
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
    }
  })

  return { app, dataPlane, events, logs, profileStore }
}

describe('M-Net dataplane route contracts', () => {
  const originalJwtSecret = process.env.MERISTEM_JWT_SECRET
  const originalInternalToken = process.env.MERISTEM_INTERNAL_TOKEN

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  afterEach(() => {
    if (originalJwtSecret === undefined) delete process.env.MERISTEM_JWT_SECRET
    else process.env.MERISTEM_JWT_SECRET = originalJwtSecret

    if (originalInternalToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
    else process.env.MERISTEM_INTERNAL_TOKEN = originalInternalToken
  })

  it('profile enable for m-net-cn@0.2.0 produces network map, relay assignment, events, and log facts', async () => {
    const fixture = createRouteFixture()
    const token = await mintToken('admin')

    await fixture.profileStore.setNetworkState('network-dataplane-test', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await fixture.app.handle(
      new Request('http://localhost/api/v0/networks/network-dataplane-test/profile', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.2.0',
          reason: 'enable production dataplane'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      profileVersion: string
      mapVersion: number
      relayAssignment: { nodeId: string; relayEndpoint: string; relayType: string }
    }
    expect(body.status).toBe('enabled')
    expect(body.profileVersion).toBe('m-net-cn@0.2.0')
    expect(body.mapVersion).toBe(1)
    expect(body.relayAssignment.nodeId).toBe('stem-cn-1')

    const latestMap = await fixture.dataPlane.networkMaps.getLatest('network-dataplane-test')
    expect(latestMap?.map.members).toHaveLength(2)
    expect(latestMap?.map.relayAssignment?.relayEndpoint).toContain('stem-cn-1')
    expect(
      await fixture.dataPlane.relayAssignments.listByNetwork('network-dataplane-test')
    ).toHaveLength(1)
    expect(
      await fixture.dataPlane.tunnelAllocations.listByNetwork('network-dataplane-test')
    ).toHaveLength(2)

    expect(fixture.events.map(event => event.type)).toEqual(
      expect.arrayContaining([
        'mnet.relay.assigned',
        'mnet.network_map.published',
        'mnet.profile.enabled'
      ])
    )
    expect(fixture.logs.some(record => record.kind === 'timeline')).toBe(true)
    expect(fixture.logs.some(record => record.kind === 'full')).toBe(true)
    expect(fixture.logs.some(record => record.kind === 'audit')).toBe(true)
  })

  it('internal dataplane routes fetch signed map and accept valid node key while rejecting invalid and duplicate keys', async () => {
    const fixture = createRouteFixture()
    const token = await mintToken('admin')

    await fixture.profileStore.setNetworkState('network-dataplane-test', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    await fixture.app.handle(
      new Request('http://localhost/api/v0/networks/network-dataplane-test/profile', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.2.0',
          reason: 'enable before route tests'
        })
      })
    )

    const mapResponse = await fixture.app.handle(
      new Request('http://localhost/internal/v0/networks/network-dataplane-test/network-map', {
        headers: internalHeaders()
      })
    )
    expect(mapResponse.status).toBe(200)
    const mapBody = (await mapResponse.json()) as {
      map: { mapVersion: number; members: unknown[] }
    }
    expect(mapBody.map.mapVersion).toBe(1)
    expect(mapBody.map.members).toHaveLength(2)

    const validRegistration = await fixture.app.handle(
      new Request(
        'http://localhost/internal/v0/networks/network-dataplane-test/nodes/leaf-cn-1/key',
        {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({
            keyId: 'leaf-cn-1-rotation-1',
            publicKey: validKey('leaf-cn-1-rotation-1'),
            createdAt: '2026-06-18T00:02:00.000Z'
          })
        }
      )
    )
    expect(validRegistration.status).toBe(200)
    const validBody = (await validRegistration.json()) as { mapVersion: number; keyId: string }
    expect(validBody.keyId).toBe('leaf-cn-1-rotation-1')
    expect(validBody.mapVersion).toBeGreaterThan(1)

    const invalidRegistration = await fixture.app.handle(
      new Request(
        'http://localhost/internal/v0/networks/network-dataplane-test/nodes/leaf-cn-1/key',
        {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({
            keyId: 'leaf-cn-1-invalid',
            publicKey: 'invalid-key',
            createdAt: '2026-06-18T00:03:00.000Z'
          })
        }
      )
    )
    expect(invalidRegistration.status).toBe(409)
    expect(
      (await invalidRegistration.json()) as { error: { code: string; message: string } }
    ).toEqual({
      error: { code: 'key.invalid', message: 'duplicate or invalid public key rejected' }
    })

    const duplicateRegistration = await fixture.app.handle(
      new Request(
        'http://localhost/internal/v0/networks/network-dataplane-test/nodes/leaf-cn-1/key',
        {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({
            keyId: 'leaf-cn-1-rotation-2',
            publicKey: validKey('leaf-cn-1-rotation-1'),
            createdAt: '2026-06-18T00:04:00.000Z'
          })
        }
      )
    )
    expect(duplicateRegistration.status).toBe(409)
    expect(
      (await duplicateRegistration.json()) as { error: { code: string; message: string } }
    ).toEqual({
      error: { code: 'key.duplicate', message: 'duplicate or invalid public key rejected' }
    })

    const nodeRuntimeMap = await fixture.app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-cn-1/network-map', {
        headers: { authorization: `Bearer ${nodeRuntimeToken}` }
      })
    )
    expect(nodeRuntimeMap.status).toBe(200)
    expect(
      ((await nodeRuntimeMap.json()) as { map: { mapVersion: number } }).map.mapVersion
    ).toBeGreaterThan(1)

    const nodeRuntimeKey = await fixture.app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-cn-1/key', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${nodeRuntimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          keyId: 'leaf-cn-1-runtime-key',
          publicKey: validKey('leaf-cn-1-runtime-key'),
          createdAt: '2026-06-18T00:05:00.000Z'
        })
      })
    )
    expect(nodeRuntimeKey.status).toBe(200)
    expect((await nodeRuntimeKey.json()) as { keyId: string }).toMatchObject({
      keyId: 'leaf-cn-1-runtime-key'
    })

    const unauthorizedRuntimeMap = await fixture.app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-cn-1/network-map')
    )
    expect(unauthorizedRuntimeMap.status).toBe(401)
  })

  it('stale internal network-map fetch returns typed fail-closed error', async () => {
    const fixture = createRouteFixture()

    await fixture.dataPlane.networkMaps.save({
      networkId: 'network-dataplane-test',
      mapVersion: 99,
      profileVersion: 'm-net-cn@0.2.0',
      publishedAt: '2026-06-18T00:00:00.000Z',
      expiresAt: '2026-06-18T00:00:00.000Z',
      signatureMetadata: {
        algorithm: 'ed25519',
        keyId: 'stale-map-key',
        publicKey: 'stale-public-key',
        value: 'placeholder-signature:stale'
      },
      map: {
        profileVersion: 'm-net-cn@0.2.0',
        networkId: 'network-dataplane-test',
        members: [],
        aclRules: [],
        expiresAt: 0,
        mapVersion: 99,
        signatureMetadata: {
          algorithm: 'ed25519',
          keyId: 'stale-map-key',
          publicKey: 'stale-public-key',
          value: 'placeholder-signature:stale'
        }
      }
    })

    const response = await fixture.app.handle(
      new Request('http://localhost/internal/v0/networks/network-dataplane-test/network-map', {
        headers: internalHeaders()
      })
    )

    expect(response.status).toBe(409)
    expect((await response.json()) as { error: { code: string; message: string } }).toEqual({
      error: { code: 'network_map.stale', message: 'network map is stale or invalid' }
    })
  })
})
