import { beforeEach, describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import type { ProfileStore } from '../../services/m-net/src/profile-store.ts'
import type { SuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import type { NetworkSuspendedOperation } from '../../packages/contracts/src/types/mnet-profile.ts'

const jwtSecret = 'test-jwt-secret'
const internalToken = 'internal-test-token'

beforeEach(() => {
  process.env.MERISTEM_JWT_SECRET = jwtSecret
  process.env.MERISTEM_INTERNAL_TOKEN = internalToken
})

function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

import type { ActorId } from '../../packages/contracts/src/literals.ts'

async function mintTestToken(actor: ActorId): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

/**
 * 内存审批客户端，始终返回成功。
 */
const inMemoryApprovalClient = {
  async create(input: {
    policyDecisionId: string; originService: string; operationId: string;
    requestedBy: string; requiredAction: string; quorumRequired: number; expiresAt: string
  }): Promise<{ ok: true; value: { approvalId: string } } | { ok: false; error: { code: string; message: string } }> {
    return { ok: true, value: { approvalId: crypto.randomUUID() } }
  }
}

function createTestApp(
  profileStore: ProfileStore,
  suspendedOps: SuspendedOperationStore,
  policyAuthorizeOverrides?: {
    authorize(_actor: string, _action: string, _resource: string): Promise<{ result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'; id: string; reasons: string[] }>
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

describe('M-Net profile external routes', () => {
  let profileStore: ProfileStore
  let suspendedOps: SuspendedOperationStore
  let app: ReturnType<typeof createMNetApp>

  beforeEach(() => {
    profileStore = createInMemoryProfileStore()
    suspendedOps = createInMemorySuspendedOperationStore()
    app = createTestApp(profileStore, suspendedOps)
  })

  // ---- GET /api/v0/network-profiles ----

  it('GET /api/v0/network-profiles returns both profiles with valid JWT', async () => {
    const token = await mintTestToken('operator')

    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles', {
        headers: bearerHeaders(token)
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { profiles: Array<{ profileVersion: string; region: string }> }
    expect(body.profiles).toHaveLength(2)
    const versions = body.profiles.map((p) => p.profileVersion).sort()
    expect(versions).toEqual(['m-net-cn@0.1.0', 'm-net-default@0.1.0'])
  })

  it('GET /api/v0/network-profiles returns 401 without bearer token', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles')
    )

    expect(response.status).toBe(401)
  })

  // ---- GET /api/v0/network-profiles/:profileVersion ----

  it('GET /api/v0/network-profiles/m-net-cn@0.1.0 returns CN profile', async () => {
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/m-net-cn@0.1.0', { headers: bearerHeaders(actorToken) })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { profileVersion: string; region: string; displayName: string; capabilities: { controlPlaneOnly: boolean } }
    expect(body.profileVersion).toBe('m-net-cn@0.1.0')
    expect(body.region).toBe('cn')
    expect(body.displayName).toBe('M-Net CN')
    expect(body.capabilities.controlPlaneOnly).toBe(true)
  })

  it('GET /api/v0/network-profiles/m-net-default@0.1.0 returns default profile', async () => {
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/m-net-default@0.1.0', { headers: bearerHeaders(actorToken) })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { profileVersion: string; region: string }
    expect(body.profileVersion).toBe('m-net-default@0.1.0')
    expect(body.region).toBe('default')
  })

  it('GET /api/v0/network-profiles/unknown returns 404', async () => {
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/unknown-profile@0.1.0', { headers: bearerHeaders(actorToken) })
    )

    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('profile.not_found')
  })

  // ---- POST /api/v0/networks/:id/profile ----

  it('POST /api/v0/networks/:id/profile with CN creates pending approval', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-1'

    // 种子网络状态为 disabled
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'enable CN profile for compliance'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      status: string
      operationId: string
      approvalId?: string
      correlationId: string
    }
    expect(body.status).toBe('pending_approval')
    expect(body.operationId).toBeDefined()
    expect(body.approvalId).toBeDefined()
    expect(body.correlationId).toBeDefined()

    // 验证网络状态已变为 enabling
    const state = await profileStore.getNetworkState(networkId)
    expect(state).not.toBeNull()
    expect(state!.status).toBe('enabling')

    // 验证挂起操作已创建
    const suspendedOp = await suspendedOps.get(body.operationId)
    expect(suspendedOp).not.toBeNull()
    expect(suspendedOp!.status).toBe('suspended')
    expect(suspendedOp!.action).toBe('mnet.profile.enable')
    expect(suspendedOp!.toProfileVersion).toBe('m-net-cn@0.1.0')
  })

  it('POST /api/v0/networks/:id/profile keeps profile unchanged when approval creation fails', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-approval-failure'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const appWithApprovalFailure = createMNetApp({
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
        async authorize(_actor, _action, _resource) {
          return { result: 'require_manual_review' as const, id: crypto.randomUUID(), reasons: [] }
        }
      },
      approvals: {
        async create() {
          return {
            ok: false as const,
            error: { code: 'approval.unavailable', message: 'approval service unavailable' }
          }
        }
      }
    })

    const response = await appWithApprovalFailure.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'approval service failure coverage'
        })
      })
    )

    expect(response.status).toBe(503)
    const body = await response.json() as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe('approval.create_failed')
    expect(body.error.message).toBe('approval service unavailable')

    // Verify network state was NOT changed (spec: approval failure leaves network profile unchanged)
    const networkState = await profileStore.getNetworkState(networkId)
    expect(networkState?.profileVersion).toBe('m-net-default@0.1.0')
    expect(networkState?.status).toBe('disabled')
  })

  it('POST /api/v0/networks/:id/profile with default disables immediately', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-2'

    // 种子网络状态为 enabled (CN profile)
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const appAllow = createTestApp(profileStore, suspendedOps, {
      async authorize(_actor, _action, _resource) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    })

    const response = await appAllow.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'disable CN profile'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      status: string
      profileVersion: string
      correlationId: string
    }
    expect(body.status).toBe('disabled')
    expect(body.profileVersion).toBe('m-net-default@0.1.0')
    expect(body.correlationId).toBeDefined()

    // 验证网络状态已变为 disabled
    const state = await profileStore.getNetworkState(networkId)
    expect(state).not.toBeNull()
    expect(state!.status).toBe('disabled')
    expect(state!.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('POST /api/v0/networks/:id/profile with already-active profile returns 409', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-3'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'try to set same profile'
        })
      })
    )

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('profile.not_enabled')
  })

  it('POST /api/v0/networks/:id/profile returns 404 for unknown network', async () => {
    const token = await mintTestToken('admin')

    const response = await app.handle(
      new Request('http://localhost/api/v0/networks/nonexistent/profile', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'enable CN'
        })
      })
    )

    expect(response.status).toBe(404)
  })

  it('POST /api/v0/networks/:id/profile returns 401 without bearer token', async () => {
    const networkId = 'test-network-4'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'enable CN'
        })
      })
    )

    expect(response.status).toBe(401)
  })

  // ---- enable from invalid state ----

  it('POST /api/v0/networks/:id/profile enable from enabling returns 409', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-5'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'try to enable again'
        })
      })
    )

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('profile.enable.invalid_state')
  })

  // ---- disable from invalid state ----

  it('POST /api/v0/networks/:id/profile disable from disabled returns 409', async () => {
    const token = await mintTestToken('admin')
    const networkId = 'test-network-6'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'try to disable'
        })
      })
    )

    expect(response.status).toBe(200) // enable flow kicks in because CN is a non-default profile
  })
})

describe('M-Net profile internal resume/reject routes', () => {
  let profileStore: ProfileStore
  let suspendedOps: SuspendedOperationStore
  let app: ReturnType<typeof createMNetApp>

  beforeEach(() => {
    profileStore = createInMemoryProfileStore()
    suspendedOps = createInMemorySuspendedOperationStore()
    app = createTestApp(profileStore, suspendedOps)
  })

  function internalPost(path: string, body?: Record<string, unknown>): Request {
    return new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: internalHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  }

  // ---- resume ----

  it('POST /internal/v0/network-profile-operations/:id/resume succeeds', async () => {
    const networkId = 'test-network-7'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; operationId: string }
    expect(body.status).toBe('resumed')
    expect(body.operationId).toBe(op.id)

    // 验证挂起操作状态变为 resumed
    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp!.status).toBe('resumed')

    // 验证网络状态变为 enabled
    const state = await profileStore.getNetworkState(networkId)
    expect(state!.status).toBe('enabled')
    expect(state!.profileVersion).toBe('m-net-cn@0.1.0')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume on stale state fails', async () => {
    const networkId = 'test-network-8'

    // 当前网络 profile 是 m-net-cn@0.1.0，但 fromProfileVersion 是 m-net-default@0.1.0
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-2',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('resume.stale_state')

    // 验证挂起操作状态变为 resume_failed
    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp!.status).toBe('resume_failed')
    expect(updatedOp!.terminalReason).toContain('stale state')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume on expired fails', async () => {
    const networkId = 'test-network-9'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    // 创建一个已过期的挂起操作
    const op = await suspendedOps.create({
      policyDecisionId: 'pd-3',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN (expired)',
      correlationId: 'corr-3',
      idempotencyKey: 'idem-3',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('operation.expired')

    // 验证挂起操作状态变为 expired
    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp!.status).toBe('expired')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume returns 404 for unknown operation', async () => {
    const response = await app.handle(
      internalPost('/internal/v0/network-profile-operations/nonexistent-id/resume')
    )

    expect(response.status).toBe(404)
  })

  it('POST /internal/v0/network-profile-operations/:id/resume returns 409 when operation is not suspended', async () => {
    const networkId = 'test-network-10'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-4',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-4',
      idempotencyKey: 'idem-4',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    // 先 resume 一次
    await suspendedOps.transition(op.id, 'resumed')

    // 再次 resume 应返回 409
    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('operation.not_suspended')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume rejects duplicate resume', async () => {
    const networkId = 'test-network-duplicate-resume'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-duplicate-resume',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'duplicate resume test',
      correlationId: 'corr-duplicate-resume',
      idempotencyKey: 'idem-duplicate-resume',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const first = await app.handle(internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`))
    expect(first.status).toBe(200)

    const second = await app.handle(internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`))
    expect(second.status).toBe(409)
    const secondBody = await second.json() as { error: { code: string } }
    expect(secondBody.error.code).toBe('operation.not_suspended')
  })

  // ---- reject ----

  it('POST /internal/v0/network-profile-operations/:id/reject succeeds', async () => {
    const networkId = 'test-network-11'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-5',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-5',
      idempotencyKey: 'idem-5',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/reject`)
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; operationId: string }
    expect(body.status).toBe('rejected')
    expect(body.operationId).toBe(op.id)

    // 验证挂起操作状态变为 rejected
    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp!.status).toBe('rejected')
    expect(updatedOp!.terminalReason).toBe('approval rejected')

    // 验证网络状态回退为 disabled
    const state = await profileStore.getNetworkState(networkId)
    expect(state!.status).toBe('disabled')
    expect(state!.profileVersion).toBe('m-net-default@0.1.0')
  })

  // ---- internal auth ----

  it('POST /internal/v0/network-profile-operations/:id/resume returns 401 without internal token', async () => {
    const response = await app.handle(
      new Request('http://localhost/internal/v0/network-profile-operations/some-id/resume', {
        method: 'POST'
      })
    )

    expect(response.status).toBe(401)
  })
})
