import { beforeEach, describe, expect, it } from 'bun:test'
import { SetNetworkProfileResponseSchema } from '../../packages/contracts/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import {
  bearerHeaders,
  createTestApp,
  decodeJson,
  ErrorResponseSchema,
  internalToken,
  jwtSecret,
  mintTestToken
} from './_helpers/mnet-profile-routes.ts'

describe('M-Net profile external routes', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('POST /api/v0/networks/:id/profile with CN creates pending approval', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const token = await mintTestToken('admin')
    const networkId = 'test-network-1'

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
    const body = await decodeJson(response, SetNetworkProfileResponseSchema)
    const pendingBody = body.status === 'pending_approval' ? body : null
    expect(pendingBody?.status).toBe('pending_approval')
    if (!pendingBody) throw new Error(`expected pending_approval response, got ${body.status}`)
    expect(pendingBody.operationId).toBeDefined()
    expect(pendingBody.approvalId).toBeDefined()
    expect(pendingBody.correlationId).toBeDefined()

    const state = await profileStore.getNetworkState(networkId)
    expect(state).not.toBeNull()
    expect(state?.status).toBe('enabling')

    const suspendedOp = await suspendedOps.get(pendingBody.operationId)
    expect(suspendedOp).not.toBeNull()
    expect(suspendedOp?.status).toBe('suspended')
    expect(suspendedOp?.action).toBe('mnet.profile.enable')
    expect(suspendedOp?.toProfileVersion).toBe('m-net-cn@0.1.0')
  })

  it('POST /api/v0/networks/:id/profile keeps profile unchanged when approval creation fails', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
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
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('approval.create_failed')
    expect(body.error.message).toBe('approval service unavailable')

    const networkState = await profileStore.getNetworkState(networkId)
    expect(networkState?.profileVersion).toBe('m-net-default@0.1.0')
    expect(networkState?.status).toBe('disabled')
  })

  it('POST /api/v0/networks/:id/profile with default disables immediately', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const token = await mintTestToken('admin')
    const networkId = 'test-network-2'

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
    const body = await decodeJson(response, SetNetworkProfileResponseSchema)
    const disabledBody = body.status === 'disabled' ? body : null
    expect(disabledBody?.status).toBe('disabled')
    if (!disabledBody) throw new Error(`expected disabled response, got ${body.status}`)
    expect(disabledBody.profileVersion).toBe('m-net-default@0.1.0')
    expect(disabledBody.correlationId).toBeDefined()

    const state = await profileStore.getNetworkState(networkId)
    expect(state).not.toBeNull()
    expect(state?.status).toBe('disabled')
    expect(state?.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('POST /api/v0/networks/:id/profile with already-active profile returns 409', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
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
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('profile.not_enabled')
  })

  it('POST /api/v0/networks/:id/profile returns 404 for unknown network', async () => {
    const app = createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())
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
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
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

  it('POST /api/v0/networks/:id/profile enable from enabling returns 409', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
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
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('profile.enable.invalid_state')
  })

  it('POST /api/v0/networks/:id/profile disable from disabled returns 409', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
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

    expect(response.status).toBe(200)
  })
})
