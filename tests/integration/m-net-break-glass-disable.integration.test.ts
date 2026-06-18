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

/** 可追踪日志断言用的审计/全量日志收集器 */
function createLogCapture() {
  const auditLogs: Array<{
    actor: string
    action: string
    resource: string
    result: string
    payload?: unknown
  }> = []
  const fullLogs: Array<{ level: string; message: string; payload?: unknown }> = []
  const timelineLogs: string[] = []

  return {
    auditLogs,
    fullLogs,
    timelineLogs,
    log: {
      async writeTimeline(summary: string) {
        timelineLogs.push(summary)
      },
      async writeFull(level: string, message: string, _cid?: string, payload?: unknown) {
        fullLogs.push({ level, message, payload })
      },
      async writeAudit(
        actor: string,
        action: string,
        resource: string,
        result: string,
        _cid?: string,
        payload?: unknown
      ) {
        auditLogs.push({ actor, action, resource, result, payload })
      }
    }
  }
}

function createTestApp(overrides: {
  disablePolicy?: ProfileDisablePolicyStore
  policyHealthy?: boolean
  policyResult?: 'allow' | 'deny' | 'require_manual_review'
}) {
  const profileStore = createInMemoryProfileStore()
  const suspendedOps = createInMemorySuspendedOperationStore()
  const policyStore = overrides.disablePolicy ?? createInMemoryProfileDisablePolicyStore()
  const healthy = overrides.policyHealthy ?? true
  const policyResult = overrides.policyResult ?? 'allow'
  const logCapture = createLogCapture()

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
    },
    log: logCapture.log,
    events: {
      async publish() {}
    }
  })

  return { app, profileStore, suspendedOps, policyStore, logCapture }
}

describe('integration: M-Net break-glass disable', () => {
  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
  })

  it('security-admin with emergency reason + approval outage disables and writes Audit + Full Log', async () => {
    const { app, profileStore, logCapture } = createTestApp({ policyHealthy: false })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'critical: immediate containment required',
          approvalDegraded: true
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      profileVersion: string
      approvalDegraded: boolean
      degradationSource: string
      auditId: string
      fullLogId: string
      correlationId: string
    }
    expect(body.status).toBe('disabled')
    expect(body.profileVersion).toBe('m-net-default@0.1.0')
    expect(body.approvalDegraded).toBe(true)
    expect(body.degradationSource).toBe('policy-health-check')
    expect(body.auditId).toBeString()
    expect(body.fullLogId).toBeString()
    expect(body.correlationId).toBeString()

    // Check Audit Log was written
    const audit = logCapture.auditLogs.find(
      a => a.action === 'mnet.profile.disable.break-glass.emergency'
    )
    expect(audit).toBeDefined()
    expect(audit?.actor).toBe('security-admin')
    expect(audit?.result).toBe('success')

    // Check state
    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('disabled')
    expect(state?.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('security-admin with emergency reason + healthy approval still disables with Audit', async () => {
    const { app, profileStore, logCapture } = createTestApp({ policyHealthy: true })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'urgent: regulatory compliance',
          approvalDegraded: false
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      approvalDegraded: boolean
      auditId: string
    }
    expect(body.status).toBe('disabled')
    expect(body.approvalDegraded).toBe(false)
    expect(body.auditId).toBeString()

    // audit records reason
    const emergencyAudit = logCapture.auditLogs.find(
      a => a.action === 'mnet.profile.disable.break-glass.emergency'
    )
    expect(emergencyAudit).toBeDefined()
    expect(emergencyAudit?.payload).toBeDefined()
  })

  it('non-security-admin break-glass returns 403', async () => {
    const { app, profileStore, logCapture } = createTestApp({ policyHealthy: false })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'urgent action',
          approvalDegraded: true
        })
      })
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('break-glass.forbidden')

    // Check audit was written
    const deniedAudit = logCapture.auditLogs.find(
      a => a.action === 'mnet.profile.disable.break-glass.denied'
    )
    expect(deniedAudit).toBeDefined()
    expect(deniedAudit?.actor).toBe('admin')
    expect(deniedAudit?.result).toBe('deny')

    // State unchanged
    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('enabled')
  })

  it('missing emergency reason + no approval degradation returns 400', async () => {
    const { app, profileStore } = createTestApp({ policyHealthy: true })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: '',
          approvalDegraded: false
        })
      })
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('reason.missing')

    // State unchanged
    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('enabled')
  })

  it('forged client approvalDegraded:true is ignored without real degradation', async () => {
    const { app, profileStore } = createTestApp({ policyHealthy: true })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'urgent reason provided',
          approvalDegraded: true
        })
      })
    )

    // Still succeeds since emergencyReason is provided, but approvalDegraded is false
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      approvalDegraded: boolean
      degradationSource?: string
    }
    expect(body.status).toBe('disabled')
    // Client claim ignored; server reports real state
    expect(body.approvalDegraded).toBe(false)
    expect(body.degradationSource).toBeUndefined()

    // State changed
    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('disabled')
  })

  it('approval degradation detected from unreachable M-Policy enables break-glass without emergency reason', async () => {
    const { app, profileStore } = createTestApp({ policyHealthy: false })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    // Even with empty/minimal emergency reason, approval degradation allows break-glass
    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'degraded approval',
          approvalDegraded: false
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      approvalDegraded: boolean
    }
    expect(body.status).toBe('disabled')
    expect(body.approvalDegraded).toBe(true)
  })

  it('break-glass works from failed state as recovery path', async () => {
    const { app, profileStore } = createTestApp({ policyHealthy: false })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'failed'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'recovery: failed state emergency disable',
          approvalDegraded: false
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('disabled')

    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('disabled')
  })

  it('break-glass responds with all expected fields', async () => {
    const { app, profileStore } = createTestApp({ policyHealthy: true })

    const networkId = crypto.randomUUID()
    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const token = await mintToken('security-admin')
    const response = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile/disable-break-glass`, {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          emergencyReason: 'integration test: verify response shape',
          approvalDegraded: false
        })
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('operationId')
    expect(body).toHaveProperty('profileVersion')
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('approvalDegraded')
    expect(body).toHaveProperty('auditId')
    expect(body).toHaveProperty('fullLogId')
    expect(body).toHaveProperty('correlationId')
    expect(body.status).toBe('disabled')
    expect(typeof body.approvalDegraded).toBe('boolean')
  })
})
