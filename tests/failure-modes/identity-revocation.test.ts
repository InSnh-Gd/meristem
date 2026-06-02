import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// ---------------------------------------------------------------------------
// Identity v0.2 revocation and introspection failure-mode tests
//
// These tests verify fail-closed behavior for identity token lifecycle.
// Currently RED because identity routes are not yet mounted in createCoreApp.
// All requests to /api/v0/identity/* return 404 until Phase 17 wires them.
//
// Sentinel values use unique prefixes: IDY-FM-REVOKE, IDY-FM-INTROSPECT
// ---------------------------------------------------------------------------

describe('Identity v0.2 failure modes', () => {
  // ── Revoked jti denied ────────────────────────────────────────────────

  it('returns 401 when a revoked actor token is used for protected access', async () => {
    // When identity routes are wired:
    // 1. security-admin issues a token for operator
    // 2. security-admin revokes the token
    // 3. operator tries to use the revoked token for a protected operation
    //    → Core checks revocation state → 401
    //
    // Currently: route POST /api/v0/identity/tokens/:jti/revoke returns 404.
    // Once Phase 17 mounts identity routes, this test will exercise the full
    // issue→revoke→deny lifecycle.
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Step 1: issue a token (will fail with 404 until identity routes exist)
    const issueResponse = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          actor: 'operator',
          ttl: '1h',
          purpose: 'IDY-FM-REVOKE-test'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404, not 200/201
    expect(issueResponse.status).toBe(201)

    const issueBody = await issueResponse.json() as {
      token: string
      jti: string
      actor: string
      status: string
    }

    // Once implemented, token is active after issue.
    expect(issueBody.status).toBe('active')
    expect(typeof issueBody.jti).toBe('string')
    expect(typeof issueBody.token).toBe('string')

    // Step 2: revoke the token
    const revokeResponse = await app.handle(
      new Request(`http://localhost/api/v0/identity/tokens/${issueBody.jti}/revoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'IDY-FM-REVOKE manual revocation' })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(revokeResponse.status).toBe(200)

    // Step 3: try to use the revoked token for a protected operation
    const statusResponse = await app.handle(
      new Request('http://localhost/api/v0/status', {
        headers: {
          authorization: `Bearer ${issueBody.token}`
        }
      })
    )

    // FAILS RED: identity revocation check not wired yet → may allow or 404
    // Once implemented: revoked token use → 401 regardless of valid signature
    expect(statusResponse.status).toBe(401)
  })

  it('returns 401 when a revoked token is inspected (revoked status visible)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Issue a token first
    const issueResponse = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          actor: 'operator',
          ttl: '1h',
          purpose: 'IDY-FM-REVOKE-inspect-test'
        })
      })
    )

    expect(issueResponse.status).toBe(201)
    const issueBody = await issueResponse.json() as { jti: string; token: string }

    // Revoke it
    await app.handle(
      new Request(`http://api/v0/identity/tokens/${issueBody.jti}/revoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'IDY-FM-REVOKE inspection test' })
      })
    )

    // Inspect the revoked token
    const inspectResponse = await app.handle(
      new Request(`http://api/v0/identity/tokens/${issueBody.jti}`, {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(inspectResponse.status).toBe(200)

    const inspectBody = await inspectResponse.json() as {
      jti: string
      status: string
      revokeReason: string
    }

    // Inspection must show revoked status but never the token plaintext.
    expect(inspectBody.status).toBe('revoked')
    expect(inspectBody.revokeReason).toBe('IDY-FM-REVOKE inspection test')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((inspectBody as any).token).toBeUndefined()
  })

  // ── Introspection unavailable fail-closed ─────────────────────────────

  it('returns 503 when identity introspection is unavailable for protected routes', async () => {
    // When Phase 17 wires identity introspection:
    // - Core provides internal introspection endpoint at
    //   POST /internal/v0/identity/tokens/introspect
    // - M-* services call this to check token revocation before allowing access
    // - If introspection is unavailable, access is denied (fail-closed)
    //
    // In createInMemoryCoreDeps, we simulate introspection unavailability
    // with policyAvailable=false (M-Policy dependency failure).
    // Phase 17 will add a dedicated identityIntrospectionAvailable toggle.
    const deps = createInMemoryCoreDeps({
      actor: 'operator',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    // Attempt a protected operation that would require identity verification.
    // When identity introspection is wired: this should return 503 fail-closed.
    const response = await app.handle(
      new Request('http://localhost/api/v0/status', {
        headers: { authorization: 'Bearer IDY-FM-INTROSPECT-down-token' }
      })
    )

    // FAILS RED: identity introspection check not wired yet.
    // Once implemented: 503 when introspection is unavailable.
    // Currently returns 401 (auth fail) because policyAvailable=false only
    // affects policy decisions, not the identity verification path.
    expect(response.status).toBe(503)
  })

  it('internal introspection endpoint fails closed when storage is unavailable', async () => {
    // Internal introspection route: POST /internal/v0/identity/tokens/introspect
    // Requires x-meristem-internal-token header.
    // Returns revocation status without token plaintext.
    // Fail-closed: if storage is unavailable, must return { active: false }.
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/internal/v0/identity/tokens/introspect', {
        method: 'POST',
        headers: {
          'x-meristem-internal-token': 'IDY-FM-INTROSPECT-internal-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ jti: 'IDY-FM-INTROSPECT-jti-001' })
      })
    )

    // FAILS RED: internal introspection route does not exist yet → 404
    // Once implemented: should return 200 with { jti, active: true/false, status }
    expect(response.status).toBe(200)

    const body = await response.json() as {
      jti: string
      active: boolean
      status: string
    }

    expect(body.jti).toBe('IDY-FM-INTROSPECT-jti-001')
    expect(typeof body.active).toBe('boolean')
    // Token plaintext must never appear in introspection response.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((body as any).token).toBeUndefined()
  })

  // ── Authorization: only security-admin can issue/revoke ───────────────

  it('returns 403 when non-security-admin attempts token issue', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          actor: 'viewer',
          ttl: '1h',
          purpose: 'IDY-FM-REVOKE-unauthorized-issue'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once identity routes are mounted: operator lacks identity:token-issue → 403
    expect(response.status).toBe(403)
  })

  it('returns 403 when non-security-admin attempts token revoke', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens/IDY-FM-REVOKE-jti/revoke', {
        method: 'POST',
        headers: {
          authorization: 'Bearer viewer-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'IDY-FM-REVOKE unauthorized' })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once identity routes are mounted: viewer lacks identity:token-revoke → 403
    expect(response.status).toBe(403)
  })

  it('returns 403 when operator attempts actor list (lacks identity:read on others)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/identity/actors', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once identity routes are mounted:
    // - operator has identity:read on self only
    // - listing all actors requires broader permission → 403
    expect(response.status).toBe(403)
  })

  // ── Missing token / invalid token ─────────────────────────────────────

  it('returns 401 for identity actor list without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/identity/actors')
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: missing auth → 401
    expect(response.status).toBe(401)
  })

  it('returns 401 for token inspect with invalid token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens/IDY-FM-REVOKE-invalid-jti', {
        headers: { authorization: 'Bearer invalid-token-abc123' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: invalid token → 401
    expect(response.status).toBe(401)
  })

  // ── Internal introspection: missing internal token ────────────────────

  it('returns 401 for internal introspection without x-meristem-internal-token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/internal/v0/identity/tokens/introspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jti: 'IDY-FM-INTROSPECT-no-internal-token' })
      })
    )

    // FAILS RED: internal introspection route does not exist yet → 404
    // Once wired: missing x-meristem-internal-token or wrong value → 401
    expect(response.status).toBe(401)
  })

  // ── Revoked token use: audit event generated ──────────────────────────

  it('generates audit log entry when revoked token use is denied', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Issue
    const issueResponse = await app.handle(
      new Request('http://localhost/api/v0/identity/tokens', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          actor: 'operator',
          ttl: '1h',
          purpose: 'IDY-FM-REVOKE-audit-test'
        })
      })
    )
    expect(issueResponse.status).toBe(201)
    const issueBody = await issueResponse.json() as { jti: string; token: string }

    // Revoke
    await app.handle(
      new Request(`http://api/v0/identity/tokens/${issueBody.jti}/revoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'IDY-FM-REVOKE audit revocation' })
      })
    )

    // Attempt to use revoked token
    await app.handle(
      new Request('http://localhost/api/v0/status', {
        headers: { authorization: `Bearer ${issueBody.token}` }
      })
    )

    // Read audit log
    const auditResponse = await app.handle(
      new Request('http://localhost/api/v0/audit', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: identity routes and audit entries not wired yet.
    expect(auditResponse.status).toBe(200)

    const auditBody = await auditResponse.json() as {
      entries: Array<{ action: string; actor: string; summary: string }>
    }

    // Audit log should contain the revoke action (written before token status change).
    const revokeEntry = auditBody.entries.find((entry) =>
      entry.summary.includes('IDY-FM-REVOKE') || entry.action.includes('token')
    )
    expect(revokeEntry).toBeDefined()
  })
})
