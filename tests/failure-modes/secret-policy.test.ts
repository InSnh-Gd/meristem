import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// ---------------------------------------------------------------------------
// SecretRef v0.1 Policy and Audit Failure-Mode Tests
//
// These tests verify fail-closed behavior for secret operations when
// M-Policy or Audit Log is unavailable, and enforce RBAC constraints.
//
// Currently RED because secrets routes are not yet mounted in createCoreApp.
// All requests to /api/v0/secrets/* return 404 until Phase 18 wires them.
//
// Sentinel prefix: SEC-FM-POLICY
// ---------------------------------------------------------------------------

describe('SecretRef v0.1 policy failure modes', () => {
  // ── Policy unavailable fail-closed ────────────────────────────────────

  it('policy unavailable blocks secret create with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'policy-down-create-test',
          scope: 'service',
          value: 'test-secret-value-for-policy-down'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: M-Policy unavailable → 503 denial.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toContain('policy')
  })

  it('policy unavailable blocks secret rotate with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-001/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'new-rotate-value',
          reason: 'SEC-FM-POLICY rotate test during policy outage'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(503)
  })

  it('policy unavailable blocks secret disable with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-001/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY disable test during policy outage'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(503)
  })

  // ── Audit unavailable fail-closed ─────────────────────────────────────

  it('audit unavailable blocks secret create with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'audit-down-create-test',
          scope: 'system',
          value: 'test-secret-value-for-audit-down'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: Audit unavailable → 503 denial.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toContain('audit')
  })

  it('audit unavailable blocks secret rotate with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-002/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'new-rotate-value',
          reason: 'SEC-FM-POLICY rotate test during audit outage'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(503)
  })

  it('audit unavailable blocks secret disable with 503', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-002/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY disable test during audit outage'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(503)
  })

  // ── Operator cannot mutate secrets ────────────────────────────────────

  it('operator cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'operator-create-attempt',
          scope: 'service',
          value: 'should-not-work'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: operator lacks secret:create → 403.
    expect(response.status).toBe(403)
  })

  it('operator cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-003/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'should-not-work',
          reason: 'operator rotation attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  it('operator cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-003/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'operator disable attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  // ── Viewer cannot mutate OR read secrets ──────────────────────────────

  it('viewer cannot read secret metadata (lacks secret:read-metadata)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-004', {
        headers: { authorization: 'Bearer viewer-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: viewer lacks secret:read-metadata → 403.
    expect(response.status).toBe(403)
  })

  it('viewer cannot list secrets (lacks secret:read-metadata)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        headers: { authorization: 'Bearer viewer-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  it('viewer cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'viewer-create-attempt',
          scope: 'service',
          value: 'should-not-work'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  it('viewer cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-005/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'should-not-work',
          reason: 'viewer rotation attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  it('viewer cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-005/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'viewer disable attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  // ── Admin can read metadata but cannot mutate ─────────────────────────

  it('admin cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'admin-create-attempt',
          scope: 'service',
          value: 'should-not-work'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: admin lacks secret:create → 403.
    expect(response.status).toBe(403)
  })

  it('admin cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-006/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'should-not-work',
          reason: 'admin rotation attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  it('admin cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-006/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'admin disable attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(403)
  })

  // ── security-admin can do everything ──────────────────────────────────

  it('security-admin can list secrets', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: security-admin has all secret permissions → 200.
    expect(response.status).toBe(200)
  })

  // ── Missing auth ──────────────────────────────────────────────────────

  it('missing auth returns 401 for secret endpoints', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets')
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: missing auth → 401.
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

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(401)
  })

  // ── Internal reference requires internal token ────────────────────────

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

    // FAILS RED: route does not exist yet → 404
    // Once wired: missing x-meristem-internal-token → 401.
    expect(response.status).toBe(401)
  })

  // ── Non-existent secret ───────────────────────────────────────────────

  it('secret rotate on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-NONEXISTENT/rotate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'new-value',
          reason: 'rotate non-existent secret'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(404)
  })

  it('secret disable on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-NONEXISTENT/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'disable non-existent secret'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(404)
  })

  it('secret show on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-POLICY-NONEXISTENT', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(response.status).toBe(404)
  })

  // ── Disabled secret cannot be rotated ─────────────────────────────────

  it('disabled secret cannot be rotated (returns 409)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // First create a secret.
    const createResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'disable-then-rotate-test',
          scope: 'node',
          value: 'initial-value'
        })
      })
    )

    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { id: string }
    const secretId = createBody.id

    // Then disable it.
    await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/disable`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY prepare for rotate-on-disabled test'
        })
      })
    )

    // Now try to rotate the disabled secret.
    const rotateResponse = await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/rotate`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'should-fail-on-disabled',
          reason: 'rotate disabled secret'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: disabled secrets cannot be rotated → 409 Conflict.
    expect(rotateResponse.status).toBe(409)
  })

  // ── Disabled secret cannot be re-disabled ─────────────────────────────

  it('disabled secret cannot be re-disabled (returns 409)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const createResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'double-disable-test',
          scope: 'system',
          value: 'initial-value'
        })
      })
    )

    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { id: string }
    const secretId = createBody.id

    // First disable.
    await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/disable`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY first disable'
        })
      })
    )

    // Second disable on already-disabled secret.
    const secondDisable = await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/disable`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY second disable attempt'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: already-disabled secrets should return 409.
    expect(secondDisable.status).toBe(409)
  })
})
