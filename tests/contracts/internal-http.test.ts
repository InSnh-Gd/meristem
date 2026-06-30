import { afterEach, describe, expect, it } from 'bun:test'
import {
  fetchReadyState,
  internalServicePorts,
  type ServedInternalApp,
  serveHttpApp
} from '../../packages/internal-http/src/index.ts'

const startedServers: ServedInternalApp[] = []
const originalInternalToken = process.env.MERISTEM_INTERNAL_TOKEN
const originalPolicyPort = internalServicePorts['m-policy']

afterEach(async () => {
  while (startedServers.length > 0) {
    const server = startedServers.pop()
    if (server) await server.stop()
  }
  process.env.MERISTEM_INTERNAL_TOKEN = originalInternalToken
  internalServicePorts['m-policy'] = originalPolicyPort
})

describe('internal http boundary', () => {
  it('serves Bun-native ready checks and can be stopped without Node.js APIs', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'internal-http-test-token'
    internalServicePorts['m-policy'] = 39_100 + Math.floor(Math.random() * 1000)
    const server = serveHttpApp('m-policy', async request => {
      if (new URL(request.url).pathname === '/ready') {
        return Response.json({ ready: true })
      }
      return Response.json({ ok: true })
    })
    startedServers.push(server)

    const ready = await fetchReadyState(`${server.url}/ready`)
    expect(ready).toBe(true)

    await server.stop()
    startedServers.length = 0

    const stoppedReady = await fetchReadyState(`${server.url}/ready`)
    expect(stoppedReady).toBe(false)
  })
})
