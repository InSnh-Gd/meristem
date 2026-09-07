import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import { coreFetch, infrastructureAvailable, startFullStack, stopFullStack } from './_shared.ts'

const infraOk = await infrastructureAvailable()
const mnetUrl = 'http://127.0.0.1:3104'

async function parseJsonOrEmpty(response: Response, scope: string): Promise<unknown> {
  if (response.status === 204) return {}
  return await response.json().catch(error => {
    console.warn(
      `${scope}: failed to parse JSON response (${response.status}) - ${error instanceof Error ? error.message : String(error)}`
    )
    return {}
  })
}

async function mnetFetch(
  path: string,
  token: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`${mnetUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`
    }
  })
  const data = await parseJsonOrEmpty(response, `mnet-profile mnetFetch ${path}`)
  return { ok: response.ok, status: response.status, data }
}

describe('e2e: m-net profile lifecycle', () => {
  let devAll: ManagedProcess | null = null
  let bffProcess: ManagedProcess | null = null
  let operatorToken = ''
  let adminToken = ''

  beforeAll(async () => {
    if (!infraOk) return
    const stack = await startFullStack()
    devAll = stack.devAll
    bffProcess = stack.bffProcess
    operatorToken = stack.operatorToken
    adminToken = stack.adminToken
  }, 60_000)

  afterAll(async () => {
    if (!infraOk || !devAll || !bffProcess) return
    await stopFullStack(devAll, bffProcess)
  }, 30_000)

  test.skipIf(!infraOk)(
    'fails closed when local development has no NetBird control-plane secret bindings',
    async () => {
      const createNetwork = await coreFetch('/api/v0/networks', operatorToken, {
        method: 'POST',
        body: JSON.stringify({ name: `e2e-mnet-profile-${Date.now()}` })
      })
      expect(createNetwork.status).toBe(200)
      const created = createNetwork.data as { network: { id: string } }
      const networkId = created.network.id

      const registerStem = await coreFetch('/api/v0/nodes', operatorToken, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'stem',
          name: `e2e-mnet-profile-stem-${Date.now()}`,
          mode: 'simulated'
        })
      })
      expect(registerStem.status).toBe(200)
      const stem = registerStem.data as { node: { id: string } }

      const joinStem = await coreFetch(`/api/v0/networks/${networkId}/members`, operatorToken, {
        method: 'POST',
        body: JSON.stringify({ nodeId: stem.node.id })
      })
      expect(joinStem.status).toBe(200)

      const enable = await mnetFetch(`/api/v0/networks/${networkId}/profile`, adminToken, {
        method: 'POST',
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.3.0',
          reason: 'e2e data-plane enable'
        })
      })
      expect(enable.status).toBe(503)
      const enableBody = enable.data as {
        error: { code: string }
      }
      expect(enableBody.error.code).toBe('netbird.config.missing_control_plane')
    },
    90_000
  )

  it('documents skip condition when PostgreSQL or NATS is unavailable', () => {
    if (!infraOk) {
      expect(true).toBe(true)
      return
    }
    expect(true).toBe(true)
  })
})
