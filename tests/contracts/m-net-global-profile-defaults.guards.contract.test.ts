import { beforeEach, describe, expect, it } from 'bun:test'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import type { MNetAppDeps } from '../../services/m-net/src/deps.ts'
import {
  bearerHeaders,
  createInMemoryTestLog,
  inMemoryApprovalClient,
  internalToken,
  jwtSecret,
  mintTestToken
} from './_helpers/mnet-profile-routes.ts'

function createDeps(overrides: Partial<MNetAppDeps> = {}): MNetAppDeps {
  const profileStore = createInMemoryProfileStore()
  const suspendedOps = createInMemorySuspendedOperationStore()
  const { log } = createInMemoryTestLog()
  return {
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
    approvals: inMemoryApprovalClient,
    log,
    events: { async publish() {} },
    ...overrides
  }
}

describe('M-Net global defaults route guards', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('returns 503 when defaults or migration dependencies are unavailable', async () => {
    const deps = createDeps()
    delete deps.policyAuthorize
    delete deps.globalDefaultsStore
    delete deps.migrationEngine
    const app = createMNetApp(deps)
    const token = await mintTestToken('admin')

    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-defaults', { headers: bearerHeaders(token) }))).status).toBe(503)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-defaults', {
      method: 'PUT', headers: bearerHeaders(token), body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'x', idempotencyKey: 'a' })
    }))).status).toBe(503)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/plan', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({ targetProfileVersion: 'm-net-cn@0.1.0', reason: 'x', idempotencyKey: 'b' })
    }))).status).toBe(503)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/apply', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({})
    }))).status).toBe(503)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/resume', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({})
    }))).status).toBe(503)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/rollback', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({ reason: 'x' })
    }))).status).toBe(503)
  })

  it('returns 403 when policy denies defaults and switch operations', async () => {
    const profileStore = createInMemoryProfileStore()
    const { log } = createInMemoryTestLog()
    const denyPolicy: MNetAppDeps['policyAuthorize'] = {
      async authorize() {
        return { result: 'deny', id: 'deny-1', reasons: ['denied for test'] }
      }
    }
    const app = createMNetApp(createDeps({
      policyAuthorize: denyPolicy,
      globalDefaultsStore: (await import('../../services/m-net/src/global-defaults-store.ts')).createInMemoryGlobalDefaultsStore(profileStore),
      migrationEngine: (await import('../../services/m-net/src/migration-engine.ts')).createMigrationEngine({
        globalDefaultsStore: (await import('../../services/m-net/src/global-defaults-store.ts')).createInMemoryGlobalDefaultsStore(profileStore),
        profileStore,
        async writeAudit() { return 'audit-1' },
        async writeFull(input) { await log.writeFull(input.level, input.message, input.correlationId, input.metadata) }
      }),
      profileStore
    }))
    const token = await mintTestToken('admin')

    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-defaults', {
      method: 'PUT', headers: bearerHeaders(token), body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'x', idempotencyKey: 'a' })
    }))).status).toBe(403)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/plan', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({ targetProfileVersion: 'm-net-cn@0.1.0', reason: 'x', idempotencyKey: 'b' })
    }))).status).toBe(403)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/apply', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({})
    }))).status).toBe(403)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/resume', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({})
    }))).status).toBe(403)
    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/rollback', {
      method: 'POST', headers: bearerHeaders(token), body: JSON.stringify({ reason: 'x' })
    }))).status).toBe(403)
  })

  it('returns 401 on rollback/resume when bearer auth is missing', async () => {
    const app = createMNetApp(createDeps())

    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    }))).status).toBe(401)

    expect((await app.handle(new Request('http://localhost/api/v0/networks/profile-switches/op/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' })
    }))).status).toBe(401)
  })
})
