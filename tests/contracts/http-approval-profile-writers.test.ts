import { describe, expect, it } from 'bun:test'
import {
  createHttpApprovalWriterPort,
  createHttpNetworkProfileWriterPort
} from '../../apps/core/src/adapters/http-approval-profile-writers.ts'

const context = {
  actor: 'admin' as const,
  bearerToken: 'token-1',
  correlationId: 'corr-1'
}

describe('HTTP approval/profile writers', () => {
  it('forwards headers and body on approval success', async () => {
    let captured: RequestInit | undefined
    const port = createHttpApprovalWriterPort({
      baseUrl: 'http://policy.local',
      fetcher: async (_input, init) => {
        captured = init
        return new Response(JSON.stringify({ approval: { id: 'a1' }, votes: [] }), { status: 200 })
      }
    })
    const result = await port.approve('a1', { reason: 'ship it' }, context)
    expect(result.ok).toBe(true)
    expect(captured?.method).toBe('POST')
    expect((captured?.headers as Record<string, string>).authorization).toBe('Bearer token-1')
    expect((captured?.headers as Record<string, string>)['x-correlation-id']).toBe('corr-1')
    expect(captured?.body).toBe(JSON.stringify({ reason: 'ship it' }))
  })

  it('maps approval 404 to approval.not_found', async () => {
    const port = createHttpApprovalWriterPort({
      fetcher: async () => new Response(JSON.stringify({ error: { code: 'approval.not_found' } }), { status: 404 })
    })
    const result = await port.reject('missing', {}, context)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('approval.not_found')
  })

  it('maps non-404 error envelopes and invalid success payloads', async () => {
    const unavailable = createHttpApprovalWriterPort({
      fetcher: async () => new Response(JSON.stringify({ error: { code: 'm-policy.unavailable', message: 'down' } }), { status: 503 })
    })
    const invalid = createHttpApprovalWriterPort({
      fetcher: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const unavailableResult = await unavailable.approve('a1', {}, context)
    const invalidResult = await invalid.reject('a1', {}, context)
    expect(unavailableResult.ok).toBe(false)
    expect(invalidResult.ok).toBe(false)
    if (!unavailableResult.ok) expect(unavailableResult.error.code).toBe('m-policy.unavailable')
    if (!invalidResult.ok) expect(invalidResult.error.code).toBe('m-policy.invalid_response')
  })

  it('tolerates non-json error bodies and covers reject success payload validation', async () => {
    const nonJson = createHttpApprovalWriterPort({
      fetcher: async () => new Response('not-json', { status: 503 })
    })
    const rejectSuccess = createHttpApprovalWriterPort({
      fetcher: async () => new Response(JSON.stringify({ approval: { id: 'a2' }, votes: [] }), { status: 200 })
    })

    const nonJsonResult = await nonJson.approve('a1', {}, context)
    const rejectSuccessResult = await rejectSuccess.reject('a2', {}, context)

    expect(nonJsonResult.ok).toBe(false)
    expect(rejectSuccessResult.ok).toBe(true)
    if (!nonJsonResult.ok) expect(nonJsonResult.error.code).toBe('m-policy.unavailable')
  })

  it('maps profile conflict, invalid success payload, and thrown transport failure', async () => {
    const conflict = createHttpNetworkProfileWriterPort({
      fetcher: async () => new Response(JSON.stringify({ error: { code: 'profile.enable.invalid_state', message: 'bad state' } }), { status: 409 })
    })
    const invalid = createHttpNetworkProfileWriterPort({
      fetcher: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const unavailable = createHttpNetworkProfileWriterPort({
      fetcher: async () => {
        throw new Error('boom')
      }
    })

    const conflictResult = await conflict.setProfile('net-1', { profileVersion: 'm-net-cn@0.1.0', reason: 'x' }, context)
    const invalidResult = await invalid.setProfile('net-1', { profileVersion: 'm-net-cn@0.1.0', reason: 'x' }, context)
    const unavailableResult = await unavailable.setProfile('net-1', { profileVersion: 'm-net-cn@0.1.0', reason: 'x' }, context)

    expect(conflictResult.ok).toBe(false)
    expect(invalidResult.ok).toBe(false)
    expect(unavailableResult.ok).toBe(false)
    if (!conflictResult.ok) expect(conflictResult.error.code).toBe('profile.enable.invalid_state')
    if (!invalidResult.ok) expect(invalidResult.error.code).toBe('mnet.invalid_response')
    if (!unavailableResult.ok) expect(unavailableResult.error.code).toBe('mnet.unavailable')
  })
})
