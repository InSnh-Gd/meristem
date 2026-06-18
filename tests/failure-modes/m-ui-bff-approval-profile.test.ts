import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createOverlayApp } from '../contracts/_helpers/http-overlay.ts'
import {
  CORE_BASE,
  captureOriginalFetch,
  createBffWithCore,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest,
  restoreOriginalFetch
} from '../contracts/_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

describe('M-UI BFF approval/profile failure modes', () => {
  it('preserves Core approval and profile unavailable envelopes', async () => {
    const approvalDownApp = createBffWithCore(
      createCoreApp(createInMemoryCoreDeps({ actor: 'admin', approvalReaderAvailable: false }))
    )

    const approvalRes = await makeRequest(
      approvalDownApp,
      '/api/v0/policy/approvals',
      'GET',
      'admin-token'
    )
    expect(approvalRes.status).toBe(503)
    expect(await approvalRes.json()).toMatchObject({ error: { code: 'm-policy.unavailable' } })

    const profileDownApp = createBffWithCore(
      createCoreApp(
        createInMemoryCoreDeps({ actor: 'admin', networkProfileReaderAvailable: false })
      )
    )

    const profileRes = await makeRequest(
      profileDownApp,
      '/api/v0/network-profiles',
      'GET',
      'admin-token'
    )
    expect(profileRes.status).toBe(503)
    expect(await profileRes.json()).toMatchObject({ error: { code: 'mnet.unavailable' } })
  })

  it('returns stale approval disabled reason for non-pending preview', async () => {
    const app = createBffWithCore(
      createCoreApp(
        createInMemoryCoreDeps({
          actor: 'security-admin',
          approvals: [
            {
              id: 'approval-approved-1',
              policyDecisionId: 'decision-approved-1',
              originService: 'm-net',
              operationId: 'operation-approved-1',
              requestedBy: 'operator',
              requiredAction: 'manual_review',
              status: 'approved',
              quorumRequired: 1,
              expiresAt: '2026-06-15T01:00:00.000Z',
              createdAt: '2026-06-15T00:00:00.000Z',
              updatedAt: '2026-06-15T00:05:00.000Z',
              completedAt: '2026-06-15T00:05:00.000Z'
            }
          ]
        })
      )
    )

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/eligibility',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-approved-1' }
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      state: 'disabled',
      disabledReason: '审批已不是 pending 状态',
      displayOnly: true
    })
  })

  it('rejects display-only command execution without delegating', async () => {
    const coreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' }))
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push(`${request.method} ${request.url}`)
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    try {
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.disable.preview/execute',
        'POST',
        'security-admin-token',
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
      )

      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'command.display_only' } })
      expect(requests).toEqual([])
    } finally {
      globalThis.fetch = delegatedFetch
    }
  })

  it('does not cache permission context between tokens in one BFF process', async () => {
    const app = createBffWithCore(createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })))

    const adminApproval = await makeRequest(app, '/api/v0/policy/approvals', 'GET', 'admin-token')
    expect(adminApproval.status).toBe(200)

    const operatorApproval = await makeRequest(
      app,
      '/api/v0/policy/approvals',
      'GET',
      'operator-token'
    )
    expect(operatorApproval.status).toBe(403)
    expect(await operatorApproval.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const adminProfiles = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'admin-token')
    expect(adminProfiles.status).toBe(200)

    const viewerProfiles = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'viewer-token')
    expect(viewerProfiles.status).toBe(403)
    expect(await viewerProfiles.json()).toMatchObject({ error: { code: 'policy.denied' } })
  })

  // =============================================================================
  // Task 3: Execute command failure-mode tests — Core error passthrough, auth mismatch,
  // degraded paths, and /internal/v0/ boundary enforcement
  // TDD RED 步骤 — MUST fail before Task 6 BFF implementation
  // =============================================================================

  /**
   * Adds mock Core write facades that return controlled error responses.
   * Used to verify BFF preserves Core error envelopes unchanged.
   */
  function addMockCoreWriteFacades(
    coreApp: ReturnType<typeof createCoreApp>,
    opts?: {
      approveStatus?: number
      approveCode?: string
      approveMessage?: string
      rejectStatus?: number
      rejectCode?: string
      rejectMessage?: string
      profileStatus?: number
      profileCode?: string
      profileMessage?: string
    }
  ) {
    const a = opts ?? {}
    return createOverlayApp(
      coreApp,
      new Elysia()
        .post('/api/v0/policy/approvals/:id/approve', ({ params, body }) => {
          const status = a.approveStatus ?? 200
          if (status >= 400) {
            return new Response(
              JSON.stringify({
                error: {
                  code: a.approveCode ?? 'policy.denied',
                  message: a.approveMessage ?? 'Permission denied'
                }
              }),
              { status, headers: { 'content-type': 'application/json' } }
            )
          }
          return {
            approval: { id: params.id, status: 'approved' },
            votes: [{ actor: 'security-admin', decision: 'approve' }],
            reason: (body as { reason?: string })?.reason,
            correlationId: 'core-mock-approve'
          }
        })
        .post('/api/v0/policy/approvals/:id/reject', ({ params, body }) => {
          const status = a.rejectStatus ?? 200
          if (status >= 400) {
            return new Response(
              JSON.stringify({
                error: {
                  code: a.rejectCode ?? 'policy.denied',
                  message: a.rejectMessage ?? 'Permission denied'
                }
              }),
              { status, headers: { 'content-type': 'application/json' } }
            )
          }
          return {
            approval: { id: params.id, status: 'rejected' },
            votes: [{ actor: 'security-admin', decision: 'reject' }],
            reason: (body as { reason?: string })?.reason,
            correlationId: 'core-mock-reject'
          }
        })
        .post('/api/v0/networks/:id/profile', ({ params, body }) => {
          const status = a.profileStatus ?? 200
          if (status >= 400) {
            return new Response(
              JSON.stringify({
                error: {
                  code: a.profileCode ?? 'profile.disable.invalid_state',
                  message: a.profileMessage ?? 'Profile state invalid'
                }
              }),
              { status, headers: { 'content-type': 'application/json' } }
            )
          }
          const typedBody = body as { profileVersion: string; reason?: string }
          return {
            networkId: params.id,
            profileVersion: typedBody.profileVersion,
            status: 'applied',
            operationId: `op-${params.id}`,
            correlationId: 'core-mock-profile'
          }
        })
    )
  }

  describe('Core error passthrough for execute commands', () => {
    it('preserves Core 403 policy.denied envelope for approval approve execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        { approveStatus: 403, approveCode: 'policy.denied', approveMessage: 'Permission denied' }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown; contract expects 403 passthrough
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'operator-token',
        { approvalId: 'a403' }
      )

      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('policy.denied')
      expect(body.error.message).toBe('Permission denied')
    })

    it('preserves Core 403 policy.denied envelope for approval reject execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        { rejectStatus: 403, rejectCode: 'policy.denied', rejectMessage: 'Permission denied' }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.reject.execute/execute',
        'POST',
        'operator-token',
        { approvalId: 'a403r' }
      )

      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('policy.denied')
    })

    it('preserves Core 404 not-found envelope for approval execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        {
          approveStatus: 404,
          approveCode: 'approval.not_found',
          approveMessage: 'Approval not found'
        }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'missing-id' }
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('approval.not_found')
      expect(body.error.message).toBe('Approval not found')
    })

    it('preserves Core 409 invalid_state envelope for profile disable execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })),
        {
          profileStatus: 409,
          profileCode: 'profile.disable.invalid_state',
          profileMessage: 'Profile state invalid for disable'
        }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.disable.execute/execute',
        'POST',
        'admin-token',
        { networkId: 'n409', profileVersion: 'm-net-cn@0.1.0' }
      )

      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('profile.disable.invalid_state')
      expect(body.error.message).toBe('Profile state invalid for disable')
    })

    it('preserves Core 503 service.unavailable envelope for approval approve execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        {
          approveStatus: 503,
          approveCode: 'service.unavailable',
          approveMessage: 'Upstream service unavailable'
        }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'a503' }
      )

      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('service.unavailable')
      expect(body.error.message).toBe('Upstream service unavailable')
    })

    it('preserves Core 503 for profile enable execute', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })),
        {
          profileStatus: 503,
          profileCode: 'service.unavailable',
          profileMessage: 'M-Net service unavailable'
        }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.execute/execute',
        'POST',
        'admin-token',
        { networkId: 'n503', profileVersion: 'm-net-cn@0.1.0' }
      )

      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('service.unavailable')
    })
  })

  describe('Authorization mismatch fails closed', () => {
    it('returns Core 403 inline when UI eligibility says enabled but Core denies', async () => {
      // Scenario: security-admin actor has policy:approve permission (eligibility → enabled),
      // but Core returns 403 for some server-side reason (e.g., approval already completed)
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        { approveStatus: 403, approveCode: 'policy.denied', approveMessage: 'Permission denied' }
      )
      const app = createBffWithServices({ coreApp })

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        // RED: currently returns 400 command.unknown
        // After implementation: BFF calls Core, Core returns 403, BFF passes it through.
        // BFF must NOT synthesize a success body when Core denies.
        const res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'a-auth-mismatch' }
        )

        expect(res.status).toBe(403)
        const body = (await res.json()) as {
          error: { code: string; message: string }
          approval?: unknown
          votes?: unknown
          correlationId?: string
        }
        expect(body.error.code).toBe('policy.denied')
        // Must NOT contain success fields
        expect(body.approval).toBeUndefined()
        expect(body.votes).toBeUndefined()
        // Verification that Core was actually called
        expect(requests.length).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('returns Core 403 inline when operator lacks permission but somehow executes', async () => {
      // operator lacks policy:approve; Core returns 403
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'operator' })),
        { approveStatus: 403, approveCode: 'policy.denied', approveMessage: 'Permission denied' }
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'operator-token',
        { approvalId: 'a-operator' }
      )

      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('policy.denied')
    })
  })

  describe('Zero /internal/v0/ calls across all execute commands', () => {
    it('execute commands never call /internal/v0/ or direct M-Policy/M-Net base URLs', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' }))
      )
      const app = createBffWithServices({ coreApp })

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'a1' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.reject.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'a2' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.enable.execute/execute',
          'POST',
          'admin-token',
          { networkId: 'n1', profileVersion: 'm-net-cn@0.1.0' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.disable.execute/execute',
          'POST',
          'admin-token',
          { networkId: 'n2', profileVersion: 'm-net-default@0.1.0' }
        )

        // RED: currently BFF returns 400 command.unknown, zero outbound requests
        // After Task 6, all outbound requests must go through CORE_BASE only
        const outboundRequests = requests.filter(r => r.url.startsWith(CORE_BASE))
        expect(outboundRequests.length).toBeGreaterThan(0)

        for (const req of requests) {
          // No internal/v0 URLs
          expect(req.url).not.toMatch(/\/internal\/v0\//)
          // No direct M-Policy or M-Net base URLs (e.g., http://m-policy:3003)
          expect(req.url).not.toMatch(/m-policy(?!\/api)/i)
          expect(req.url).not.toMatch(/m-net(?!\/api)/i)
          expect(req.url).not.toMatch(/m-log(?!\/api)/i)
          // All outbound must be to Core
          if (req.url.startsWith('http')) {
            expect(req.url).toMatch(
              new RegExp(`^${CORE_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)
            )
          }
        }
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })
  })

  describe('Core error inline — no success body synthesis', () => {
    it('never synthesizes a success body when Core returns error', async () => {
      // Test all four commands with Core returning errors
      const testCases: Array<{
        label: string
        commandId: string
        token: string
        body: Record<string, string>
        expectedStatus: number
        expectedCode: string
      }> = [
        {
          label: 'approval approve 403',
          commandId: 'policy.approval.approve.execute',
          token: 'operator-token',
          body: { approvalId: 'a1' },
          expectedStatus: 403,
          expectedCode: 'policy.denied'
        },
        {
          label: 'approval reject 404',
          commandId: 'policy.approval.reject.execute',
          token: 'security-admin-token',
          body: { approvalId: 'missing-id' },
          expectedStatus: 404,
          expectedCode: 'approval.not_found'
        },
        {
          label: 'profile enable 503',
          commandId: 'network.profile.enable.execute',
          token: 'admin-token',
          body: { networkId: 'n1', profileVersion: 'v1' },
          expectedStatus: 503,
          expectedCode: 'service.unavailable'
        },
        {
          label: 'profile disable 409',
          commandId: 'network.profile.disable.execute',
          token: 'admin-token',
          body: { networkId: 'n2', profileVersion: 'v2' },
          expectedStatus: 409,
          expectedCode: 'profile.disable.invalid_state'
        }
      ]

      for (const tc of testCases) {
        const coreApp = addMockCoreWriteFacades(
          createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
          tc.commandId === 'policy.approval.approve.execute'
            ? {
                approveStatus: tc.expectedStatus,
                approveCode: tc.expectedCode,
                approveMessage: 'Controlled error'
              }
            : tc.commandId === 'policy.approval.reject.execute'
              ? {
                  rejectStatus: tc.expectedStatus,
                  rejectCode: tc.expectedCode,
                  rejectMessage: 'Controlled error'
                }
              : {
                  profileStatus: tc.expectedStatus,
                  profileCode: tc.expectedCode,
                  profileMessage: 'Controlled error'
                }
        )

        const app = createBffWithServices({ coreApp })

        // RED: currently returns 400 command.unknown
        const res = await makeRequest(
          app,
          `/api/v0/commands/${tc.commandId}/execute`,
          'POST',
          tc.token,
          tc.body
        )

        expect(res.status, `[${tc.label}] expected status ${tc.expectedStatus}`).toBe(
          tc.expectedStatus
        )
        const body = (await res.json()) as {
          error?: { code: string }
          approval?: unknown
          votes?: unknown
          correlationId?: string
        }
        expect(body.error, `[${tc.label}] must have error`).toBeDefined()
        if (body.error) {
          expect(body.error.code, `[${tc.label}] error code`).toBe(tc.expectedCode)
        }
        // Must NOT contain success fields
        expect(body.approval, `[${tc.label}] must not have approval`).toBeUndefined()
      }
    })
  })
})
