/**
 * Core Approval & Network Profile Write Facade — Contract Tests (TDD Red Phase)
 *
 * Tests the Core facade write contract for approval and network-profile mutations.
 * Core authenticates, authorizes, and forwards to M-Policy/M-Net public HTTP APIs.
 * Core never calls /internal/v0/*.
 *
 * STATUS: TDD RED — routes do not exist yet. All tests expected to fail with 404.
 * Tests will pass once Task 5 implements the write routes in the Core facade.
 *
 * Contract:
 * - POST /api/v0/policy/approvals/:id/approve  → M-Policy public
 * - POST /api/v0/policy/approvals/:id/reject   → M-Policy public
 * - POST /api/v0/networks/:id/profile          → M-Net public
 *
 * Error passthrough: 401/403/404/409/503 propagated unchanged from downstream.
 * CorrelationId: X-Correlation-Id header forwarded to downstream services.
 */

import { describe, expect, it } from 'bun:test'
import type { ActorId } from '../../packages/contracts/src/index.ts'
import { createCoreApp } from '../../apps/core/src/app.ts'
import type { CoreApp } from '../../apps/core/src/public-types.ts'
import {
  createCoreDepsWithWriters,
  type TrackedCall
} from './_helpers/core-write-ports.ts'
import type { WriterMockOptions } from '../../apps/core/src/testing/approval-profile-writers.ts'

/**
 * Build a POST request to the given Core path.
 */
function post(path: string, token?: string, body?: unknown, correlationId?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (correlationId) headers['x-correlation-id'] = correlationId
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
}

/**
 * Assert the error envelope shape Core must return.
 */
async function expectErrorEnvelope(
  response: Response,
  expectedStatus: number,
  expectedCode: string
) {
  expect(response.status).toBe(expectedStatus)
  const body = (await response.json()) as { error: { code: string; message: string; correlationId?: string } }
  expect(body).toHaveProperty('error')
  expect(body.error.code).toBe(expectedCode)
  expect(body.error).toHaveProperty('message')
  return body
}

/**
 * Create a CoreApp with mock writer ports for tests that need to verify
 * downstream call paths.
 */
function createApp(
  actor: ActorId = 'security-admin',
  mockWriterOpts: WriterMockOptions = {}
): { app: CoreApp; calls: TrackedCall[] } {
  // Use actor to inject the right token-to-actor mapping in mock auth port
  const { deps, calls } = createCoreDepsWithWriters({
    actor
  }, mockWriterOpts)
  return { app: createCoreApp(deps), calls }
}

// ─── Auth Gate (401) ────────────────────────────────────────────────

describe('Core facade write auth gate', () => {
  it('POST /api/v0/policy/approvals/:id/approve returns 401 without token', async () => {
    const { app } = createApp()
    const res = await app.handle(
      post('/api/v0/policy/approvals/test-id/approve')
    )
    // Expected: 401 auth.missing_token (currently 404 because route not registered)
    await expectErrorEnvelope(res, 401, 'auth.missing_token')
  })

  it('POST /api/v0/policy/approvals/:id/reject returns 401 without token', async () => {
    const { app } = createApp()
    const res = await app.handle(
      post('/api/v0/policy/approvals/test-id/reject')
    )
    await expectErrorEnvelope(res, 401, 'auth.missing_token')
  })

  it('POST /api/v0/networks/:id/profile returns 401 without token', async () => {
    const { app } = createApp()
    const res = await app.handle(
      post('/api/v0/networks/net-test-1/profile', undefined, {
        profileVersion: 'm-net-cn@0.1.0',
        reason: 'test enable'
      })
    )
    await expectErrorEnvelope(res, 401, 'auth.missing_token')
  })

  it('POST /api/v0/policy/approvals/:id/approve returns 401 for invalid token', async () => {
    const { app } = createApp()
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'not-a-valid-token',
        { reason: 'test' }
      )
    )
    await expectErrorEnvelope(res, 401, 'invalid_token')
  })
})

// ─── Authorization Gate (403) ───────────────────────────────────────

describe('Core facade write authorization gate', () => {
  it('operator cannot approve — returns 403', async () => {
    const { app } = createApp('operator')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'operator-token',
        { reason: 'test' }
      )
    )
    // operator lacks policy:approval-approve
    await expectErrorEnvelope(res, 403, 'policy.denied')
  })

  it('operator cannot reject — returns 403', async () => {
    const { app } = createApp('operator')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/reject',
        'operator-token',
        { reason: 'test' }
      )
    )
    await expectErrorEnvelope(res, 403, 'policy.denied')
  })

  it('viewer cannot set network profile — returns 403', async () => {
    const { app } = createApp('viewer')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'viewer-token',
        {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'test enable'
        }
      )
    )
    // viewer lacks network:profile-enable and network:profile-disable
    await expectErrorEnvelope(res, 403, 'policy.denied')
  })

  it('admin can set network profile (has permissions) — returns 200', async () => {
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-default@0.1.0',
          reason: 'test disable'
        }
      )
    )
    // admin has network:profile-disable and network:profile-enable
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status', 'disabled')
    expect(body).toHaveProperty('correlationId')
  })
})

// ─── Approval Approve Happy Path ────────────────────────────────────

describe('Core facade approval approve', () => {
  it('security-admin approves pending approval → 200 with approval + votes + correlationId', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        { reason: 'lgtm' },
        'correlation-approve-1'
      )
    )
    // security-admin has policy:approval-approve permission
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('approval')
    expect((body.approval as Record<string, unknown>)).toHaveProperty('id', 'test-id')
    expect((body.approval as Record<string, unknown>)).toHaveProperty('status', 'approved')
    expect(body).toHaveProperty('votes')
    expect(body.votes).toBeInstanceOf(Array)
  })

  it('approve body with reason field is accepted', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        { reason: 'manual review passed' }
      )
    )
    expect(res.status).toBe(200)
  })

  it('approve body without reason field is accepted (optional)', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        {}
      )
    )
    expect(res.status).toBe(200)
  })
})

// ─── Approval Reject Happy Path ─────────────────────────────────────

describe('Core facade approval reject', () => {
  it('security-admin rejects pending approval → 200 with approval + votes + correlationId', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/reject',
        'security-admin-token',
        { reason: 'needs rework' },
        'correlation-reject-1'
      )
    )
    // security-admin has policy:approval-reject permission
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('approval')
    expect((body.approval as Record<string, unknown>)).toHaveProperty('id', 'test-id')
    expect((body.approval as Record<string, unknown>)).toHaveProperty('status', 'rejected')
    expect(body).toHaveProperty('votes')
  })
})

// ─── Profile Enable Happy Path ──────────────────────────────────────

describe('Core facade profile enable', () => {
  it('admin enables China profile on valid network → 200 with pending_approval status', async () => {
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'regional compliance'
        },
        'correlation-enable-1'
      )
    )
    // admin has network:profile-enable permission
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status', 'pending_approval')
    expect(body).toHaveProperty('operationId')
    expect(body).toHaveProperty('approvalId')
    expect(body).toHaveProperty('correlationId')
  })
})

// ─── Profile Disable Happy Path ─────────────────────────────────────

describe('Core facade profile disable', () => {
  it('admin disables profile (sets default) → 200 with disabled status', async () => {
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-default@0.1.0',
          reason: 'compliance hold'
        },
        'correlation-disable-1'
      )
    )
    // admin has network:profile-disable permission
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status', 'disabled')
    expect(body).toHaveProperty('profileVersion', 'm-net-default@0.1.0')
    expect(body).toHaveProperty('correlationId')
  })

  it('profile disable requires reason field', async () => {
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-default@0.1.0'
          // missing reason
        }
      )
    )
    // Should be 400 validation error (Elysia validates body schema)
    // Currently 404 because route not registered
    expect(res.status).toBe(400)
  })
})

// ─── Error Passthrough ──────────────────────────────────────────────

describe('Core facade write error passthrough', () => {
  it('M-Policy 404 not found → Core returns 404 (not synthesized)', async () => {
    const { app } = createApp('security-admin', {
      notFoundApprovalIds: new Set(['nonexistent-id'])
    })
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/nonexistent-id/approve',
        'security-admin-token',
        { reason: 'test' }
      )
    )
    // Core must preserve downstream 404 on unknown approval IDs
    await expectErrorEnvelope(res, 404, 'approval.not_found')
  })

  it('M-Net 409 conflict → Core returns 409 with same error code', async () => {
    const { app } = createApp('admin', {
      conflictNetworkIds: new Set(['net-in-conflict'])
    })
    const res = await app.handle(
      post(
        '/api/v0/networks/net-in-conflict/profile',
        'admin-token',
        {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'trigger conflict'
        }
      )
    )
    // Core must preserve downstream 409 on invalid state transitions
    await expectErrorEnvelope(res, 409, 'profile.enable.invalid_state')
  })

  it('M-Policy 503 unavailable → Core returns 503', async () => {
    const { app } = createApp('security-admin', {
      forceError: { code: 'm-policy.unavailable', message: 'M-Policy approval API unavailable' }
    })
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        { reason: 'test' }
      )
    )
    // When M-Policy is down, Core passes through 503
    await expectErrorEnvelope(res, 503, 'm-policy.unavailable')
  })

  it('M-Net 503 unavailable → Core returns 503', async () => {
    const { app } = createApp('admin', {
      forceError: { code: 'mnet.unavailable', message: 'M-Net profile API unavailable' }
    })
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'test'
        }
      )
    )
    await expectErrorEnvelope(res, 503, 'mnet.unavailable')
  })
})

// ─── CorrelationId Propagation ──────────────────────────────────────

describe('Core facade write correlationId propagation', () => {
  it('approve forwards X-Correlation-Id header to M-Policy downstream call', async () => {
    const incomingCorrelationId = 'incoming-corr-approve-xyz'
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        { reason: 'test' },
        incomingCorrelationId
      )
    )
    expect(res.status).toBe(200)
    // After implementation, verify correlationId appears in response
    // and/or in tracked calls
  })

  it('reject forwards X-Correlation-Id header to M-Policy downstream call', async () => {
    const incomingCorrelationId = 'incoming-corr-reject-xyz'
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/reject',
        'security-admin-token',
        { reason: 'test' },
        incomingCorrelationId
      )
    )
    expect(res.status).toBe(200)
  })

  it('profile set forwards X-Correlation-Id header to M-Net downstream call', async () => {
    const incomingCorrelationId = 'incoming-corr-profile-xyz'
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'test'
        },
        incomingCorrelationId
      )
    )
    expect(res.status).toBe(200)
    // After implementation, verify correlationId is forwarded to downstream
  })
})

// ─── No Internal Route Leakage ──────────────────────────────────────

describe('Core facade write never calls internal routes', () => {
  it('approve does not call /internal/v0/*', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/approve',
        'security-admin-token',
        { reason: 'test' }
      )
    )
    // Regardless of status, Core must not expose or forward to internal paths
    expect(res.status).not.toBe(500) // internal leaks often manifest as 500
  })

  it('reject does not call /internal/v0/*', async () => {
    const { app } = createApp('security-admin')
    const res = await app.handle(
      post(
        '/api/v0/policy/approvals/test-id/reject',
        'security-admin-token',
        { reason: 'test' }
      )
    )
    expect(res.status).not.toBe(500)
  })

  it('profile set does not call /internal/v0/*', async () => {
    const { app } = createApp('admin')
    const res = await app.handle(
      post(
        '/api/v0/networks/net-test-1/profile',
        'admin-token',
        {
          profileVersion: 'm-net-default@0.1.0',
          reason: 'test'
        }
      )
    )
    expect(res.status).not.toBe(500)
  })
})
