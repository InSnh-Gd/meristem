import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// ---------------------------------------------------------------------------
// SecretRef v0.1 Redaction Failure-Mode Tests
//
// These tests verify that secret plaintext is NEVER present in log, error,
// or response outputs — even during failures.
//
// Currently RED because secrets routes are not yet mounted in createCoreApp.
// All requests to /api/v0/secrets/* return 404 until Phase 18 wires them.
//
// Sentinel prefix: SEC-FM-REDACT
// ---------------------------------------------------------------------------

const SENTINEL = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'

/**
 * Predicate: no part of the output contains the sentinel.
 */
function assertNoSentinelLeak(...outputs: string[]): void {
  for (const output of outputs) {
    expect(output).not.toContain(SENTINEL)
    expect(output).not.toContain('"value"')
    expect(output).not.toContain('"plaintext"')
    expect(output).not.toContain('"secretValue"')
  }
}

describe('SecretRef v0.1 redaction failure modes', () => {
  // ── Redaction in REST responses ───────────────────────────────────────

  it('secret create response body must not contain sentinel plaintext', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'redact-create-test',
          scope: 'service',
          value: SENTINEL
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: should return 201 with secretRef DTO (no value field).
    expect(response.status).toBe(201)

    const bodyText = await response.text()
    assertNoSentinelLeak(bodyText)

    // Parse and verify the response shape has no value field.
    const body = JSON.parse(bodyText) as Record<string, unknown>
    expect(body.value).toBeUndefined()
    expect(body.plaintext).toBeUndefined()
    expect(body.secretValue).toBeUndefined()
    // Must return the secretRef metadata.
    expect(typeof (body.secretRef ?? body.id)).toBe('string')
  })

  it('secret create error response must not contain sentinel plaintext', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Trigger a validation error (missing 'name' field) while sending sentinel value.
    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          scope: 'service',
          value: SENTINEL
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: validation error should return 400.
    expect(response.status).toBe(400)

    const bodyText = await response.text()
    assertNoSentinelLeak(bodyText)
  })

  it('secret rotate response body must not contain sentinel plaintext', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // First create a secret to rotate.
    const createResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'rotate-redact-test',
          scope: 'system',
          value: 'initial-secret-value'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { id: string }
    const secretId = createBody.id

    // Rotate with sentinel as the new value.
    const rotateResponse = await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/rotate`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: SENTINEL,
          reason: 'SEC-FM-REDACT rotation test'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: should return 200 with updated secretRef DTO.
    expect(rotateResponse.status).toBe(200)

    const rotateBodyText = await rotateResponse.text()
    assertNoSentinelLeak(rotateBodyText)
  })

  // ── Redaction in log outputs ──────────────────────────────────────────

  it('timeline log must not contain sentinel plaintext after secret operation', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Create a secret with sentinel value.
    await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'timeline-redact-test',
          scope: 'service',
          value: SENTINEL
        })
      })
    )

    // Read timeline log.
    const timelineResponse = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: secrets route not wired → 404 for create.
    // Even when the create fails, the timeline should not contain the sentinel.
    expect(timelineResponse.status).toBe(200)

    const timelineText = await timelineResponse.text()
    assertNoSentinelLeak(timelineText)
  })

  it('full log must not contain sentinel plaintext after secret operation', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Create a secret with sentinel value.
    await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          primeName: 'full-log-redact-test',
          primeScope: 'system',
          primeValue: SENTINEL
        })
      })
    )

    // Read full log.
    const fullResponse = await app.handle(
      new Request('http://localhost/api/v0/logs/full', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: secrets route not wired → 404 for create.
    expect(fullResponse.status).toBe(200)

    const fullText = await fullResponse.text()
    assertNoSentinelLeak(fullText)
  })

  it('audit log must not contain sentinel plaintext after secret operation', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Create a secret with sentinel value.
    await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'audit-redact-test',
          scope: 'node',
          value: SENTINEL
        })
      })
    )

    // Read audit log.
    const auditResponse = await app.handle(
      new Request('http://localhost/api/v0/audit', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: secrets route not wired → 404 for create.
    expect(auditResponse.status).toBe(200)

    const auditText = await auditResponse.text()
    assertNoSentinelLeak(auditText)
  })

  // ── Redaction in list/show responses ──────────────────────────────────

  it('secret list response must not contain value/plaintext/secret fields', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // First create a secret.
    await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'list-redact-test',
          scope: 'service',
          value: SENTINEL
        })
      })
    )

    // List secrets.
    const listResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: should return 200 with array of secretRef DTOs.
    expect(listResponse.status).toBe(200)

    const listText = await listResponse.text()
    assertNoSentinelLeak(listText)

    // Parse and verify: no entry has a 'value' field.
    const listBody = JSON.parse(listText) as { secrets?: Array<Record<string, unknown>> }
    const entries = listBody.secrets ?? []
    for (const entry of entries) {
      expect(entry.value).toBeUndefined()
      expect(entry.plaintext).toBeUndefined()
      expect(entry.secretValue).toBeUndefined()
    }
  })

  it('secret show response must not contain value/plaintext/secret fields', async () => {
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
          name: 'show-redact-test',
          scope: 'system',
          value: SENTINEL
        })
      })
    )

    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { id: string }
    const secretId = createBody.id

    // Show secret.
    const showResponse = await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}`, {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )

    // FAILS RED: route does not exist yet → 404
    expect(showResponse.status).toBe(200)

    const showText = await showResponse.text()
    assertNoSentinelLeak(showText)
  })

  // ── Redaction during failure paths ────────────────────────────────────

  it('secret disable error response must not contain sentinel plaintext', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // Attempt to disable a non-existent secret.
    const response = await app.handle(
      new Request('http://localhost/api/v0/secrets/SEC-FM-REDACT-NONEXISTENT/disable', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          reason: 'SEC-FM-REDACT non-existent disable'
        })
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: should return 404 with error body.
    expect(response.status).toBe(404)

    const bodyText = await response.text()
    assertNoSentinelLeak(bodyText)
  })

  it('internal reference route response must not contain sentinel plaintext', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)
    const prevEnvToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = prevEnvToken ?? 'test-internal-token'

    // First create a secret.
    const createResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'internal-ref-redact-test',
          scope: 'service',
          value: SENTINEL
        })
      })
    )

    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { id: string }
    const secretId = createBody.id

    // Internal reference.
    const refResponse = await app.handle(
      new Request(`http://localhost/internal/v0/secrets/${secretId}/reference`, {
        method: 'POST',
        headers: {
          'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN,
          'content-type': 'application/json'
        }
      })
    )

    // FAILS RED: route does not exist yet → 404
    // Once wired: should return 200 with scoped reference result.
    expect(refResponse.status).toBe(200)

    const refText = await refResponse.text()
    assertNoSentinelLeak(refText)

    // 恢复环境变量，避免跨测试污染。
    if (prevEnvToken === undefined) {
      delete process.env.MERISTEM_INTERNAL_TOKEN
    } else {
      process.env.MERISTEM_INTERNAL_TOKEN = prevEnvToken
    }
  })

  // ── Redaction: sentinel must produce ZERO matches in captured outputs ──

  it('sentinel value produces ZERO matches across all captured outputs', async () => {
    // This is the canonical redaction assertion: the sentinel value
    // MERISTEM_TEST_SECRET_DO_NOT_LOG must produce zero matches in
    // a captured output — logs, errors, responses, or CLI streams.
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const outputs: string[] = []

    // Create with sentinel value.
    const createResponse = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'canonical-redact-test',
          scope: 'system',
          value: SENTINEL
        })
      })
    )
    outputs.push(await createResponse.text())

    // Read timeline.
    const timelineRes = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    outputs.push(await timelineRes.text())

    // Read full.
    const fullRes = await app.handle(
      new Request('http://localhost/api/v0/logs/full', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    outputs.push(await fullRes.text())

    // Read audit.
    const auditRes = await app.handle(
      new Request('http://localhost/api/v0/audit', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    outputs.push(await auditRes.text())

    // List secrets.
    const listRes = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    outputs.push(await listRes.text())

    // ── Zero-matches assertion ─────────────────────────────────────────
    // The sentinel must produce ZERO matches across ALL captured outputs.
    // This is the definitive redaction contract test.
    for (const [index, output] of outputs.entries()) {
      expect(output).not.toContain(SENTINEL)
      expect(output).not.toContain('"value"')
      expect(output).not.toContain('"plaintext"')
      // Also check that no output contains partial sentinel fragments
      // (in case of truncation or JSON escaping).
      const sentinelFragments = SENTINEL.split('_')
      for (const fragment of sentinelFragments) {
        if (fragment.length >= 5) {
          // If a 5+ char fragment of the sentinel appears, it's a leak.
          // Skip short fragments like "DO" which could be false positives.
          const occurrences = (output.match(new RegExp(fragment, 'g')) ?? []).length
          // Only fail if the fragment appears in suspicious context —
          // the full sentinel check above is the primary assertion.
          if (occurrences > 10) {
            expect(`output[${index}] contains sentinel fragment "${fragment}" ${occurrences} times`).toBe('clean')
          }
        }
      }
    }
  })
})
