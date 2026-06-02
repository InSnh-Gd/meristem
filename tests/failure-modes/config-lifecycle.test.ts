import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// ---------------------------------------------------------------------------
// Config Lifecycle v0.1 Failure-Mode Tests
//
// These tests verify fail-closed behavior for config lifecycle operations.
// Currently RED because config routes are not yet mounted in createCoreApp.
// All requests to /api/v0/configs/* return 404 until Phase 19 wires them.
//
// Sentinel values use unique prefixes: CFG-FM-POLICY, CFG-FM-AUDIT,
// CFG-FM-ACK, CFG-FM-ROLLBACK
// ---------------------------------------------------------------------------

// ── 测试辅助 ──────────────────────────────────────────────────────────────

function bearerHeaders(actor: string): Record<string, string> {
  return {
    authorization: `Bearer ${actor}-token`,
    'content-type': 'application/json'
  }
}

function internalHeaders(): Record<string, string> {
  return {
    'x-meristem-internal-token': 'CFG-FM-internal-token',
    'content-type': 'application/json'
  }
}

function validDraftPayload(overrides?: Record<string, unknown>) {
  return {
    domain: 'core' as const,
    targetScope: ['m-net'],
    payload: {
      opentelemetry: { enabled: true, endpoint: 'http://otel:4317' }
    },
    ...overrides
  }
}

async function draftConfig(
  app: ReturnType<typeof createCoreApp>,
  token: string,
  overrides?: Record<string, unknown>
) {
  return app.handle(
    new Request('http://localhost/api/v0/configs/drafts', {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify(validDraftPayload(overrides))
    })
  )
}

async function publishConfig(
  app: ReturnType<typeof createCoreApp>,
  configId: string,
  token: string,
  reason = 'CFG-FM smoke publish'
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/publish`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ reason })
    })
  )
}

async function rollbackConfig(
  app: ReturnType<typeof createCoreApp>,
  configId: string,
  toVersion: string,
  token: string,
  reason = 'CFG-FM smoke rollback'
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/rollback`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ toVersion, reason })
    })
  )
}

async function getConfig(
  app: ReturnType<typeof createCoreApp>,
  configId: string,
  token: string
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}`, {
      headers: bearerHeaders(token)
    })
  )
}

async function listConfigs(
  app: ReturnType<typeof createCoreApp>,
  token: string
) {
  return app.handle(
    new Request('http://localhost/api/v0/configs', {
      headers: bearerHeaders(token)
    })
  )
}

async function validateConfig(
  app: ReturnType<typeof createCoreApp>,
  configId: string,
  token: string
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/validate`, {
      method: 'POST',
      headers: bearerHeaders(token)
    })
  )
}

async function submitApplyAck(
  app: ReturnType<typeof createCoreApp>,
  configId: string,
  ack: { ackedBy: string; status: 'acked' | 'failed'; errorCode?: string; errorMessage?: string }
) {
  return app.handle(
    new Request(`http://localhost/internal/v0/configs/${configId}/apply-ack`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(ack)
    })
  )
}

// ── 故障模式测试 ──────────────────────────────────────────────────────────

describe('Config lifecycle failure modes', () => {
  // ── Policy Unavailable: publish fail-closed ───────────────────────────

  it('returns 503 when policy is unavailable for config publish', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    // ── First draft a config with allow deps then verify with deny deps ──
    // Phase 19: policy must be available for publish/rollback (high-risk ops).
    // If policy is unavailable, publish must fail-closed → 503.
    const response = await publishConfig(app, 'CFG-FM-POLICY-cfg-001', 'security-admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires config routes: policy unavailable → 503 fail-closed.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('policy.unavailable')
  })

  it('returns 503 when policy is unavailable for config rollback', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-POLICY-cfg-002', '0.1.0', 'security-admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires rollback route: policy unavailable → 503.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('policy.unavailable')
  })

  // ── Audit Unavailable: publish / rollback fail-closed ─────────────────

  it('returns 503 when audit log is unavailable for config publish', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await publishConfig(app, 'CFG-FM-AUDIT-cfg-001', 'security-admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires config routes: audit unavailable → 503.
    // Config publish/rollback are high-risk → audit required.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('audit.unavailable')
  })

  it('returns 503 when audit log is unavailable for config rollback', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-AUDIT-cfg-002', '0.1.0', 'security-admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires rollback route: audit unavailable → 503.
    expect(response.status).toBe(503)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('audit.unavailable')
  })

  // ── Draft / Read do NOT require policy or audit ────────────────────

  it('allows config draft even when policy is unavailable (draft is not high-risk)', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await draftConfig(app, 'admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires draft route: draft is not high-risk → policy/audit
    // not required → 201.
    expect(response.status).toBe(201)

    const body = await response.json() as { config: { id: string; status: string } }
    expect(body.config.status).toBe('draft')
  })

  it('allows config list even when audit is unavailable (read is not high-risk)', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'viewer',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await listConfigs(app, 'viewer')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires list route: read is not high-risk → audit not
    // required → 200.
    expect(response.status).toBe(200)
  })

  it('allows config show even when both policy and audit are unavailable', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'operator',
      policyAvailable: false,
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await getConfig(app, 'CFG-FM-DEGRADED-read-001', 'operator')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires show route: read is normal-risk, not high-risk →
    // should succeed even when policy/audit degraded.
    expect(response.status).toBe(200)
  })

  // ── Duplicate Ack: idempotent or rejected ────────────────────────────

  it('returns 409 for duplicate apply ack on the same config', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // First ack: accepted
    const first = await submitApplyAck(app, 'CFG-FM-ACK-dup-001', {
      ackedBy: 'm-net',
      status: 'acked'
    })
    // FAILS RED: internal config route not mounted → 404.
    // Once Phase 19 wires the internal apply-ack route:
    // first ack → 200, duplicate ack → 409.
    expect(first.status).toBe(200)

    // Second ack with same configId: duplicate → rejected
    const second = await submitApplyAck(app, 'CFG-FM-ACK-dup-001', {
      ackedBy: 'm-extension',
      status: 'acked'
    })

    expect(second.status).toBe(409)

    const body = await second.json() as { error: { code: string } }
    expect(body.error.code).toBe('config.duplicate_ack')
  })

  it('returns 200 for idempotent ack when same service acks same status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const ack = {
      ackedBy: 'm-net',
      status: 'acked' as const
    }

    const first = await submitApplyAck(app, 'CFG-FM-ACK-idem-001', ack)
    // FAILS RED: internal config route not mounted → 404.
    expect(first.status).toBe(200)

    // Same service, same status → idempotent replay → 200 (no state change)
    const second = await submitApplyAck(app, 'CFG-FM-ACK-idem-001', ack)

    expect(second.status).toBe(200)
  })

  // ── Ack Timeout: applied → failed transition ─────────────────────────

  it('ack timeout transitions config from applied to failed', async () => {
    // Phase 19 must implement the ack timeout window.
    // If a config is published and not all target services ack within
    // the timeout window, the config transitions to 'failed'.
    // This test verifies that a missing ack within the window leads to
    // the correct state transition without corrupting the latest
    // published version.
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Step 1: draft and publish a config targeting m-net
    const draft = await draftConfig(app, 'admin')
    // FAILS RED: config routes not mounted → 404.
    expect(draft.status).toBe(201)
    const draftBody = await draft.json() as {
      config: { id: string; configVersion: string }
    }

    // Step 2: publish (m-net is in targetScope)
    const pub = await publishConfig(app, draftBody.config.id, 'admin')
    expect(pub.status).toBe(200)

    // Step 3: verify published version is the latest
    const show = await getConfig(app, draftBody.config.id, 'admin')
    expect(show.status).toBe(200)
    const showBody = await show.json() as {
      config: { status: string; configVersion: string }
    }
    expect(showBody.config.status).toBe('published')

    // Step 4: query status after timeout (simulate elapsed time)
    // The timeout implementation would transition published → failed
    // when no ack is received within the window.
    const showAfter = await getConfig(app, draftBody.config.id, 'admin')
    expect(showAfter.status).toBe(200)
    const showAfterBody = await showAfter.json() as {
      config: { status: string; configVersion: string }
    }

    // After timeout with no ack: status should be 'failed'
    // But the latest published version should still be preserved.
    // FAILS RED: config routes not mounted → 404.
    // Once wired with timeout logic: status → 'failed'.
    expect(showAfterBody.config.status).toBe('failed')
    // The configVersion of the failed record must match the published version.
    expect(showAfterBody.config.configVersion).toBe(draftBody.config.configVersion)
  })

  // ── Rollback Unknown Version: rejected ───────────────────────────────

  it('returns 409 when rollback targets an unknown config version', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(
      app,
      'CFG-FM-ROLLBACK-cfg-001',
      '99.99.99', // non-existent version
      'security-admin'
    )

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires rollback route: unknown version → 409.
    expect(response.status).toBe(409)

    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('config.unknown_version')
  })

  it('returns 409 when rollback to same version as current', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Rollback to the same version is a no-op and should be rejected
    const response = await rollbackConfig(
      app,
      'CFG-FM-ROLLBACK-cfg-002',
      '1.0.0',
      'security-admin',
      'attempt rollback to current'
    )

    // FAILS RED: config routes not mounted → 404.
    // Once wired: rollback to current version → 409.
    expect(response.status).toBe(409)
  })

  // ── Authorization: only admin+ can publish/rollback ─────────────────

  it('returns 403 when viewer attempts config draft', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await draftConfig(app, 'viewer')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires config routes: viewer lacks config:draft → 403.
    expect(response.status).toBe(403)
  })

  it('returns 403 when operator attempts config publish', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    // operator has config:read + config:validate but NOT config:publish
    const response = await publishConfig(app, 'CFG-FM-AUTHZ-cfg-001', 'operator')

    // FAILS RED: config routes not mounted → 404.
    expect(response.status).toBe(403)
  })

  it('returns 403 when operator attempts config rollback', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-AUTHZ-cfg-002', '0.1.0', 'operator')

    // FAILS RED: config routes not mounted → 404.
    expect(response.status).toBe(403)
  })

  // ── Missing authentication ──────────────────────────────────────────

  it('returns 401 for config list without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs')
    )

    // FAILS RED: config routes not mounted → 404.
    // Once wired: missing auth → 401.
    expect(response.status).toBe(401)
  })

  it('returns 401 for config draft without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validDraftPayload())
      })
    )

    // FAILS RED: config routes not mounted → 404.
    // Once wired: missing auth → 401.
    expect(response.status).toBe(401)
  })

  // ── Internal apply-ack: missing internal token ──────────────────────

  it('returns 401 for internal apply-ack without x-meristem-internal-token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/internal/v0/configs/CFG-FM-ACK-no-internal/apply-ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ackedBy: 'm-net', status: 'acked' })
      })
    )

    // FAILS RED: internal config route not mounted → 404.
    // Once wired: missing internal token → 401.
    expect(response.status).toBe(401)
  })

  // ── Plaintext secret rejection on draft ─────────────────────────────

  it('returns 400 when draft payload contains plaintext secret keys', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const badPayload = {
      domain: 'core',
      targetScope: ['m-net'],
      payload: {
        settings: {
          apiKey: 'sk-plaintext-bad',
          password: 'pwd123'
        }
      }
    }

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs/drafts', {
        method: 'POST',
        headers: bearerHeaders('admin'),
        body: JSON.stringify(badPayload)
      })
    )

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires draft route with secret validation:
    // plaintext secrets → 400.
    expect(response.status).toBe(400)

    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('config.secret_plaintext_rejected')
    expect(body.error.message).toContain('plaintext')
  })

  // ── Validate: fails when config is not in draft state ───────────────

  it('returns 409 when validating a config that is not in draft status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Attempt to validate a config that is already published
    const response = await validateConfig(app, 'CFG-FM-VALIDATE-not-draft', 'admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires validate route: non-draft config → 409.
    expect(response.status).toBe(409)
  })

  // ── Publish: fails when config is not in validated state ────────────

  it('returns 409 when publishing a config that is not in validated status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Attempt to publish a draft without validating first
    const response = await publishConfig(app, 'CFG-FM-PUB-not-validated', 'admin')

    // FAILS RED: config routes not mounted → 404.
    // Once Phase 19 wires publish route: not validated → 409.
    expect(response.status).toBe(409)
  })
})
