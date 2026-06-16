import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  captureOriginalFetch,
  createBffWithCore,
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
})
