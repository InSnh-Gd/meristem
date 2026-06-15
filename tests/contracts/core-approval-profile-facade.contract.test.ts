import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { createCoreApp } from '../../apps/core/src/app.ts'
import {
  createHttpApprovalReaderPort,
  createHttpNetworkProfileReaderPort
} from '../../apps/core/src/adapters.ts'
import type { PublicReaderFetch } from '../../apps/core/src/adapters/http-approval-profile-readers.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import type { PolicyApproval } from '../../packages/contracts/src/index.ts'
import {
  ApprovalDetailResponseSchema,
  ApprovalListResponseSchema,
  MNetProfileDetailResponseSchema,
  MNetProfileListResponseSchema
} from '../../packages/contracts/src/index.ts'

const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'x-correlation-id': 'facade-corr-1' })

const approval: PolicyApproval = {
  id: 'approval-facade-1',
  policyDecisionId: 'decision-facade-1',
  originService: 'm-net',
  operationId: 'operation-facade-1',
  requestedBy: 'operator',
  requiredAction: 'manual_review',
  status: 'pending',
  quorumRequired: 1,
  expiresAt: '2026-06-15T01:00:00.000Z',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z'
}

describe('Core approval and network profile read facade contract', () => {
  it('GET /api/v0/policy/approvals returns deterministic approval queue via Core port', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin', approvals: [approval] }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/policy/approvals', { headers: headers('admin-token') })
    )

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(ApprovalListResponseSchema)(await response.json())
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0]?.id).toBe('approval-facade-1')
  })

  it('GET /api/v0/policy/approvals returns an empty queue instead of 404', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin', approvals: [] }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/policy/approvals', { headers: headers('admin-token') })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ approvals: [] })
  })

  it('GET /api/v0/policy/approvals/:id returns approval detail with votes', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin', approvals: [approval] }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/policy/approvals/approval-facade-1', {
        headers: headers('admin-token')
      })
    )

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(ApprovalDetailResponseSchema)(await response.json())
    expect(body.id).toBe('approval-facade-1')
    expect(body.votes).toEqual([])
  })

  it('approval facade returns Core error envelopes for auth, permission, not found, and service failure', async () => {
    const adminApp = createCoreApp(createInMemoryCoreDeps({ actor: 'admin', approvals: [approval] }))
    const operatorApp = createCoreApp(createInMemoryCoreDeps({ actor: 'operator', approvals: [approval] }))
    const downApp = createCoreApp(
      createInMemoryCoreDeps({ actor: 'admin', approvalReaderAvailable: false })
    )

    const missingToken = await adminApp.handle(
      new Request('http://localhost/api/v0/policy/approvals')
    )
    expect(missingToken.status).toBe(401)
    expect(await missingToken.json()).toMatchObject({ error: { code: 'auth.missing_token' } })

    const denied = await operatorApp.handle(
      new Request('http://localhost/api/v0/policy/approvals', { headers: headers('operator-token') })
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const missing = await adminApp.handle(
      new Request('http://localhost/api/v0/policy/approvals/missing-approval', {
        headers: headers('admin-token')
      })
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'approval.not_found' } })

    const unavailable = await downApp.handle(
      new Request('http://localhost/api/v0/policy/approvals', { headers: headers('admin-token') })
    )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'm-policy.unavailable' } })
  })

  it('GET /api/v0/network-profiles returns profile list via Core port', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles', { headers: headers('admin-token') })
    )

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(MNetProfileListResponseSchema)(await response.json())
    expect(body.profiles.map(profile => profile.profileVersion).sort()).toEqual([
      'm-net-cn@0.1.0',
      'm-net-default@0.1.0'
    ])
  })

  it('GET /api/v0/network-profiles/:profileVersion returns profile detail', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))

    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/m-net-cn@0.1.0', {
        headers: headers('admin-token')
      })
    )

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(MNetProfileDetailResponseSchema)(await response.json())
    expect(body.profileVersion).toBe('m-net-cn@0.1.0')
    expect(body.capabilities.controlPlaneOnly).toBe(true)
  })

  it('network profile facade returns Core error envelopes for auth, permission, not found, and service failure', async () => {
    const adminApp = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))
    const viewerApp = createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' }))
    const downApp = createCoreApp(
      createInMemoryCoreDeps({ actor: 'admin', networkProfileReaderAvailable: false })
    )

    const invalid = await adminApp.handle(
      new Request('http://localhost/api/v0/network-profiles', { headers: headers('not-a-token') })
    )
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_token' } })

    const denied = await viewerApp.handle(
      new Request('http://localhost/api/v0/network-profiles', { headers: headers('viewer-token') })
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'policy.denied' } })

    const missing = await adminApp.handle(
      new Request('http://localhost/api/v0/network-profiles/unknown-profile@0.1.0', {
        headers: headers('admin-token')
      })
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'profile.not_found' } })

    const unavailable = await downApp.handle(
      new Request('http://localhost/api/v0/network-profiles', { headers: headers('admin-token') })
    )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'mnet.unavailable' } })
  })

  it('production reader adapters call only owning service public HTTP paths and forward caller token', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = []
    const fetcher: PublicReaderFetch = async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      calls.push({ url, authorization: headers.get('authorization') })
      const data = url.includes('policy/approvals')
        ? { approvals: [] }
        : { profiles: [] }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const context = { actor: 'admin' as const, bearerToken: 'admin-token', correlationId: 'corr-1' }

    await createHttpApprovalReaderPort({ baseUrl: 'http://m-policy.local', fetcher }).list(context)
    await createHttpNetworkProfileReaderPort({ baseUrl: 'http://m-net.local', fetcher }).list(context)

    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/api/v0/policy/approvals',
      '/api/v0/network-profiles'
    ])
    expect(calls.every(call => !call.url.includes('/internal/v0/'))).toBe(true)
    expect(calls.every(call => call.authorization === 'Bearer admin-token')).toBe(true)
  })
})
