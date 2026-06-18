import { beforeEach, describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import {
  createInMemoryProfileDisablePolicyStore,
  type ProfileDisablePolicyStore
} from '../../services/m-net/src/profile-disable-policy.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

const jwtSecret = 'test-jwt-secret'

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function mintToken(
  actor: 'viewer' | 'operator' | 'admin' | 'security-admin'
): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function createTestApp(overrides: {
  disablePolicy?: ProfileDisablePolicyStore
  policyResult?: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  policyHealthy?: boolean
}) {
  const profileStore = createInMemoryProfileStore()
  const suspendedOps = createInMemorySuspendedOperationStore()
  const policyStore = overrides.disablePolicy ?? createInMemoryProfileDisablePolicyStore()
  const healthy = overrides.policyHealthy ?? true
  const policyResult = overrides.policyResult ?? 'allow'

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
      async authorize(_actor, _action, _resource) {
        return { result: policyResult, id: crypto.randomUUID(), reasons: [] }
      }
    },
    approvals: {
      async create() {
        return { ok: true as const, value: { approvalId: crypto.randomUUID() } }
      }
    },
    profileDisablePolicy: policyStore,
    policyHealthCheck: {
      async checkHealth() {
        return { healthy }
      }
    }
  })

  return { app, profileStore, suspendedOps, policyStore }
}

describe('M-Net disable approval failure modes', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
  })

  it('normal disable with requireApproval:false succeeds immediately', async () => {
    const { app, profileStore } = createTestApp({})

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'disable without approval'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string; profileVersion: string }
    expect(body.status).toBe('disabled')
    expect(body.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('normal disable with requireApproval:true enters approval-required path', async () => {
    const { app, profileStore, policyStore } = createTestApp({})

    await policyStore.setPolicy({
      requireApproval: true,
      emergencyBreakGlassEnabled: true,
      reason: 'testing approval gate',
      idempotencyKey: crypto.randomUUID()
    })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'disable requires approval'
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      operationId: string
      approvalId?: string
    }
    expect(body.status).toBe('pending_approval')
    expect(body.operationId).toBeString()
    expect(body.approvalId).toBeString()
  })

  it('requireApproval:true gate prevents immediate disable', async () => {
    const { app, profileStore, policyStore } = createTestApp({})

    await policyStore.setPolicy({
      requireApproval: true,
      emergencyBreakGlassEnabled: true,
      reason: 'testing approval gate',
      idempotencyKey: crypto.randomUUID()
    })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'disable requires approval'
        })
      })
    )

    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('pending_approval')

    // Verify network still in enabled state (not disabled)
    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('disabling')
  })

  it('policy authorize deny blocks disable even with requireApproval:false', async () => {
    const { app, profileStore } = createTestApp({
      policyResult: 'deny'
    })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'should be policy denied'
        })
      })
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('policy.denied')
  })

  it('cannot disable from disabled state (already disabled no-op)', async () => {
    const { app, profileStore } = createTestApp({})

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'already disabled'
        })
      })
    )

    expect(response.status).toBe(409)
  })
})
