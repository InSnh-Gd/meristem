import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import { createSecret, disableSecret, listSecrets, rotateSecret } from '../helpers/secret-policy.ts'

export function registerSecretPolicyDegradedOpsTests(): void {
  it('policy unavailable blocks secret create with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await createSecret(app, 'security-admin', {
      name: 'policy-down-create-test',
      scope: 'service',
      value: 'test-secret-value-for-policy-down'
    })

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toContain('policy')
  })

  it('policy unavailable blocks secret rotate with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'security-admin', 'SEC-FM-POLICY-001', {
      value: 'new-rotate-value',
      reason: 'SEC-FM-POLICY rotate test during policy outage'
    })

    expect(response.status).toBe(503)
  })

  it('policy unavailable blocks secret disable with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'security-admin', 'SEC-FM-POLICY-001', {
      reason: 'SEC-FM-POLICY disable test during policy outage'
    })

    expect(response.status).toBe(503)
  })

  it('audit unavailable blocks secret create with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await createSecret(app, 'security-admin', {
      name: 'audit-down-create-test',
      scope: 'system',
      value: 'test-secret-value-for-audit-down'
    })

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toContain('audit')
  })

  it('audit unavailable blocks secret rotate with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'security-admin', 'SEC-FM-POLICY-002', {
      value: 'new-rotate-value',
      reason: 'SEC-FM-POLICY rotate test during audit outage'
    })

    expect(response.status).toBe(503)
  })

  it('audit unavailable blocks secret disable with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'security-admin', 'SEC-FM-POLICY-002', {
      reason: 'SEC-FM-POLICY disable test during audit outage'
    })

    expect(response.status).toBe(503)
  })

  it('security-admin can list secrets', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await listSecrets(app, 'security-admin')

    expect(response.status).toBe(200)
  })

  it('missing auth returns 401 for secret endpoints', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(new Request('http://localhost/api/v0/secrets'))

    expect(response.status).toBe(401)
  })

  it('invalid token returns 401 for secret create', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer invalid-token-abc123',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'invalid-token-test',
          scope: 'service',
          value: 'should-fail'
        })
      })
    )

    expect(response.status).toBe(401)
  })

  it('internal secret reference missing internal token returns 401', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/internal/v0/secrets/SEC-FM-POLICY-INT/disable', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY internal token test'
        })
      })
    )

    expect(response.status).toBe(401)
  })
}
