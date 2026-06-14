import { beforeEach, describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import type { ActorId } from '../../packages/contracts/src/literals.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import type { ProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import type { MNetApp } from '../../services/m-net/src/public-types.ts'
import type { SuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

const jwtSecret = 'test-jwt-secret'
const internalToken = 'internal-test-token'

type EmittedEvent = {
  subject: string
  type: string
  payload: unknown
  correlationId?: string | undefined
}

type TimelineLog = {
  summary: string
  subject?: string | undefined
  correlationId?: string | undefined
}

type AuditLog = {
  actor: string
  action: string
  resource: string
  result: string
  correlationId?: string | undefined
  payload?: unknown | undefined
}

type Collectors = {
  events: EmittedEvent[]
  timeline: TimelineLog[]
  audit: AuditLog[]
}

beforeEach(() => {
  process.env.MERISTEM_JWT_SECRET = jwtSecret
  process.env.MERISTEM_INTERNAL_TOKEN = internalToken
})

function internalPost(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { [internalTokenHeaderName]: internalToken }
  })
}

async function mintTestToken(actor: ActorId): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

const inMemoryApprovalClient = {
  async create(): Promise<{ ok: true; value: { approvalId: string } }> {
    return { ok: true, value: { approvalId: crypto.randomUUID() } }
  }
}

function createTestApp(
  profileStore: ProfileStore,
  suspendedOps: SuspendedOperationStore,
  collectors: Collectors,
  policyAuthorizeOverrides?: {
    authorize(
      _actor: string,
      _action: string,
      _resource: string
    ): Promise<{
      result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
      id: string
      reasons: string[]
    }>
  }
) {
  return createMNetApp({
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
    events: {
      async publish(subject, type, payload, correlationId) {
        collectors.events.push({
          subject,
          type,
          payload,
          ...(correlationId ? { correlationId } : {})
        })
      }
    },
    log: {
      async writeTimeline(summary, subject, correlationId) {
        collectors.timeline.push({
          summary,
          ...(subject ? { subject } : {}),
          ...(correlationId ? { correlationId } : {})
        })
      },
      async writeFull() {
        return
      },
      async writeAudit(actor, action, resource, result, correlationId, payload) {
        collectors.audit.push({
          actor,
          action,
          resource,
          result,
          ...(correlationId ? { correlationId } : {}),
          ...(payload === undefined ? {} : { payload })
        })
      }
    },
    policyAuthorize: policyAuthorizeOverrides ?? {
      async authorize(_actor, action, _resource) {
        if (action === 'network:profile-read') {
          return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
        }
        return { result: 'require_manual_review' as const, id: crypto.randomUUID(), reasons: [] }
      }
    }
  })
}

describe('M-Net profile events and logs contract', () => {
  let profileStore: ProfileStore
  let suspendedOps: SuspendedOperationStore
  let collectors: Collectors
  let app: MNetApp

  beforeEach(() => {
    profileStore = createInMemoryProfileStore()
    suspendedOps = createInMemorySuspendedOperationStore()
    collectors = { events: [], timeline: [], audit: [] }
    app = createTestApp(profileStore, suspendedOps, collectors)
  })

  it('enable request emits mnet.profile.enable.requested.v0', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'net-ev-1'
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'enable cn' })
      })
    )

    expect(response.status).toBe(200)
    expect(
      collectors.events.some(event => event.subject === 'mnet.profile.enable.requested.v0')
    ).toBe(true)
  })

  it('enable resume success emits mnet.profile.enabled.v0', async () => {
    const networkId = 'net-ev-2'
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })
    const op = await suspendedOps.create({
      policyDecisionId: 'pd-resume',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable',
      correlationId: 'corr-resume',
      idempotencyKey: 'idem-resume',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(200)
    expect(collectors.events.some(event => event.subject === 'mnet.profile.enabled.v0')).toBe(true)
  })

  it('disable emits requested and disabled events', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'net-ev-3'
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const appAllow = createTestApp(profileStore, suspendedOps, collectors, {
      async authorize(_actor, _action, _resource) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    })

    const response = await appAllow.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-default@0.1.0', reason: 'disable cn' })
      })
    )

    expect(response.status).toBe(200)
    expect(
      collectors.events.some(event => event.subject === 'mnet.profile.disable.requested.v0')
    ).toBe(true)
    expect(collectors.events.some(event => event.subject === 'mnet.profile.disabled.v0')).toBe(true)
  })

  it('resume stale failure emits mnet.profile.apply_failed.v0', async () => {
    const networkId = 'net-ev-4'
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabling'
    })
    const op = await suspendedOps.create({
      policyDecisionId: 'pd-stale',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable',
      correlationId: 'corr-stale',
      idempotencyKey: 'idem-stale',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    expect(collectors.events.some(event => event.subject === 'mnet.profile.apply_failed.v0')).toBe(
      true
    )
  })

  it('reject emits mnet.profile.enable.canceled.v0', async () => {
    const networkId = 'net-ev-5'
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })
    const op = await suspendedOps.create({
      policyDecisionId: 'pd-reject',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable',
      correlationId: 'corr-reject',
      idempotencyKey: 'idem-reject',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/reject`)
    )

    expect(response.status).toBe(200)
    expect(
      collectors.events.some(event => event.subject === 'mnet.profile.enable.canceled.v0')
    ).toBe(true)
  })

  it('writes audit entries on enable/disable flows', async () => {
    const token = await mintTestToken('admin')
    const enableNetworkId = 'net-ev-6-enable'
    await profileStore.setNetworkState(enableNetworkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })
    await app.handle(
      new Request(`http://localhost/api/v0/networks/${enableNetworkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'enable cn' })
      })
    )

    const disableNetworkId = 'net-ev-6-disable'
    await profileStore.setNetworkState(disableNetworkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })
    const appAllow = createTestApp(profileStore, suspendedOps, collectors, {
      async authorize(_actor, _action, _resource) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    })
    await appAllow.handle(
      new Request(`http://localhost/api/v0/networks/${disableNetworkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-default@0.1.0', reason: 'disable cn' })
      })
    )

    expect(collectors.audit.some(entry => entry.action === 'mnet.profile.enable.request')).toBe(
      true
    )
    expect(collectors.audit.some(entry => entry.action === 'mnet.profile.disable.request')).toBe(
      true
    )
    expect(collectors.audit.some(entry => entry.action === 'mnet.profile.disable.success')).toBe(
      true
    )
  })

  it('writes timeline entries on enable/disable flows', async () => {
    const token = await mintTestToken('admin')
    const enableNetworkId = 'net-ev-7-enable'
    await profileStore.setNetworkState(enableNetworkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })
    await app.handle(
      new Request(`http://localhost/api/v0/networks/${enableNetworkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-cn@0.1.0', reason: 'enable cn' })
      })
    )

    const disableNetworkId = 'net-ev-7-disable'
    await profileStore.setNetworkState(disableNetworkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })
    const appAllowTl = createTestApp(profileStore, suspendedOps, collectors, {
      async authorize(_actor, _action, _resource) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    })
    await appAllowTl.handle(
      new Request(`http://localhost/api/v0/networks/${disableNetworkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ profileVersion: 'm-net-default@0.1.0', reason: 'disable cn' })
      })
    )

    expect(
      collectors.timeline.some(entry => entry.subject === 'mnet.profile.enable.requested')
    ).toBe(true)
    expect(collectors.timeline.some(entry => entry.subject === 'mnet.profile.disabled')).toBe(true)
  })
})
