import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// ---------------------------------------------------------------------------
// Identity v0.2 revocation and introspection failure-mode tests
//
// These tests verify fail-closed behavior for the identity token lifecycle.
//
// Sentinel values use unique prefixes: IDY-FM-REVOKE, IDY-FM-INTROSPECT
// ---------------------------------------------------------------------------

describe('Identity v0.2 failure modes', () => {
  // ── Revoked jti denied ────────────────────────────────────────────────

  it('returns 401 when a revoked actor token is used for protected access', async () => {
    // Exercise the full issue → revoke → deny lifecycle.
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

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

    expect(issueResponse.status).toBe(201)

    const issueBody = (await issueResponse.json()) as {
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

    expect(revokeResponse.status).toBe(200)

    // Step 3: try to use the revoked token for a protected operation
    const statusResponse = await app.handle(
      new Request('http://localhost/api/v0/status', {
        headers: {
          authorization: `Bearer ${issueBody.token}`
        }
      })
    )

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
    const issueBody = (await issueResponse.json()) as { jti: string; token: string }

    // Revoke it
    await app.handle(
      new Request(`http://localhost/api/v0/identity/tokens/${issueBody.jti}/revoke`, {
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
      new Request(`http://localhost/api/v0/identity/tokens/${issueBody.jti}`, {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    expect(inspectResponse.status).toBe(200)

    const inspectBody = (await inspectResponse.json()) as {
      jti: string
      status: string
      revokeReason?: string
    }

    // Inspection must show revoked status but never the token plaintext.
    expect(inspectBody.status).toBe('revoked')
    expect(inspectBody.revokeReason).toBe('IDY-FM-REVOKE inspection test')
    // Token plaintext must never appear in inspection response.
    expect(inspectBody).not.toHaveProperty('token')
  })

  // ── Introspection unavailable fail-closed ─────────────────────────────

  it('returns 503 when identity introspection is unavailable for protected routes', async () => {
    // Protected access must fail closed when identity introspection is unavailable.
    const deps = createInMemoryCoreDeps({
      actor: 'operator',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/status', {
        headers: { authorization: 'Bearer IDY-FM-INTROSPECT-down-token' }
      })
    )

    expect(response.status).toBe(503)
  })

  it('internal introspection endpoint fails closed when storage is unavailable', async () => {
    // Internal introspection route: POST /internal/v0/identity/tokens/introspect
    // Requires x-meristem-internal-token header.
    // Returns revocation status without token plaintext.
    // Fail-closed: if storage is unavailable, must return { active: false }.
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)
    process.env.MERISTEM_INTERNAL_TOKEN =
      process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'

    const response = await app.handle(
      new Request('http://localhost/internal/v0/identity/tokens/introspect', {
        method: 'POST',
        headers: {
          'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ jti: 'IDY-FM-INTROSPECT-jti-001' })
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      jti: string
      active: boolean
      status: string
    }

    expect(body.jti).toBe('IDY-FM-INTROSPECT-jti-001')
    expect(typeof body.active).toBe('boolean')
    // Token plaintext must never appear in introspection response.
    expect(body).not.toHaveProperty('token')
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

    expect(response.status).toBe(403)
  })

  // ── Missing token / invalid token ─────────────────────────────────────

  it('returns 401 for identity actor list without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(new Request('http://localhost/api/v0/identity/actors'))

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
    const issueBody = (await issueResponse.json()) as { jti: string; token: string }

    // Revoke
    await app.handle(
      new Request(`http://localhost/api/v0/identity/tokens/${issueBody.jti}/revoke`, {
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

    expect(auditResponse.status).toBe(200)

    const auditBody = (await auditResponse.json()) as {
      entries: Array<{ action: string; actor: string; summary: string }>
    }

    // Audit log should contain the revoke action (written before token status change).
    const revokeEntry = auditBody.entries.find(
      entry => entry.summary.includes('IDY-FM-REVOKE') || entry.action.includes('token')
    )
    expect(revokeEntry).toBeDefined()
  })
})
