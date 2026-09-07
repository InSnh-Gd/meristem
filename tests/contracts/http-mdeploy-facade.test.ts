import { describe, expect, it } from 'bun:test'
import { createHttpMDeployFacadePort } from '../../apps/core/src/adapters/http-mdeploy-facade.ts'
import type { MDeployFacadeContext } from '../../apps/core/src/types/mdeploy-facade.ts'
import type { FacadeServiceResult } from '../../apps/core/src/routes/facade-support.ts'

const context: MDeployFacadeContext = {
  actor: 'admin',
  bearerToken: 'admin-token',
  correlationId: 'corr-1'
}

const validSummary = {
  latestDigest: { algorithm: 'sha256' as const, value: 'ab'.repeat(32) },
  stale: false,
  controllerAvailable: true
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

async function unwrap<T>(result: Promise<FacadeServiceResult<T>>) {
  return result
}

describe('HTTP M-Deploy facade adapter', () => {
  it('decodes a valid desired-state response at the boundary', async () => {
    const calls: string[] = []
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async (input, init) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
        return jsonResponse(validSummary)
      }
    })
    const result = await unwrap(port.desiredState(context))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual(validSummary)
    expect(calls).toEqual(['GET http://m-deploy.internal/api/v0/deploy/desired-state'])
  })

  it('forwards bearer token and correlation id unchanged', async () => {
    let seenHeaders: Record<string, string> | undefined
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async (_input, init) => {
        seenHeaders = Object.fromEntries(new Headers(init?.headers).entries())
        return jsonResponse(validSummary)
      }
    })
    await port.desiredState(context)
    expect(seenHeaders?.authorization).toBe('Bearer admin-token')
    expect(seenHeaders?.['x-correlation-id']).toBe('corr-1')
  })

  it('maps malformed success payloads to a typed invalid_response error', async () => {
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async () => jsonResponse({ stale: 'not-a-boolean' })
    })
    const result = await unwrap(port.desiredState(context))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('m-deploy.invalid_response')
  })

  it('maps downstream 404 to deploy.not_found for non-detail endpoints', async () => {
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async () => jsonResponse({ error: { code: 'x', message: 'y' } }, 404)
    })
    const result = await unwrap(port.evidence(context))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('deploy.not_found')
  })

  it('maps downstream 404 to null for proposal detail lookup', async () => {
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async () =>
        jsonResponse({ error: { code: 'deploy.proposal_not_found', message: 'nope' } }, 404)
    })
    const result = await unwrap(port.proposal('missing', context))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeNull()
  })

  it('extracts downstream error codes from the error envelope', async () => {
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async () =>
        jsonResponse(
          { error: { code: 'deploy.not_approved', message: 'proposal needs two approvals' } },
          409
        )
    })
    const result = await unwrap(port.apply({ proposalId: 'p', agentId: 'a' }, context))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('deploy.not_approved')
  })

  it('returns unavailable on network failure', async () => {
    const port = createHttpMDeployFacadePort({
      baseUrl: 'http://m-deploy.internal',
      fetcher: async () => {
        throw new Error('connection refused')
      }
    })
    const result = await unwrap(port.desiredState(context))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('m-deploy.unavailable')
  })
})
