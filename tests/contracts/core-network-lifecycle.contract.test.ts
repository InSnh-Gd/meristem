import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import type { CoreApp } from '../../apps/core/src/public-types.ts'
import type { ActorId } from '../../packages/contracts/src/index.ts'
import { createCoreDepsWithWriters } from './_helpers/core-write-ports.ts'

/**
 * Core 网络 lifecycle facade 契约：删除网络、移除成员、更新元数据。
 * Core 只做认证、授权、审计与事件收敛；真实状态转换由 M-Net 通过内部契约完成。
 */

const originalOtelExporter = process.env.MERISTEM_OTEL_EXPORTER

function createApp(actor: ActorId): CoreApp {
  const { deps } = createCoreDepsWithWriters({ actor })
  return createCoreApp(deps)
}

function request(path: string, method: string, token: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
}

describe('Core network lifecycle facade', () => {
  beforeAll(() => {
    process.env.MERISTEM_OTEL_EXPORTER = 'none'
  })

  afterAll(() => {
    if (originalOtelExporter === undefined) delete process.env.MERISTEM_OTEL_EXPORTER
    else process.env.MERISTEM_OTEL_EXPORTER = originalOtelExporter
  })

  it('admin deletes a network through the facade and receives the network id', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    const app = createCoreApp(deps)
    // in-memory port 拥有 network-test-1 之前需要先创建
    await app.handle(
      request('/api/v0/networks', 'POST', 'admin-token', { name: 'lifecycle-network' })
    )
    const listRes = await app.handle(request('/api/v0/networks', 'GET', 'admin-token'))
    const list = (await listRes.json()) as { networks: Array<{ id: string; name: string }> }
    const target = list.networks.find(network => network.name === 'lifecycle-network')
    expect(target).toBeDefined()

    const res = await app.handle(request(`/api/v0/networks/${target!.id}`, 'DELETE', 'admin-token'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { networkId: string }
    expect(body.networkId).toBe(target!.id)
  })

  it('viewer cannot delete a network — authorization gate returns 403', async () => {
    const app = createApp('viewer')
    const res = await app.handle(request('/api/v0/networks/some-network', 'DELETE', 'viewer-token'))
    expect(res.status).toBe(403)
  })

  it('viewer cannot remove a network member', async () => {
    const app = createApp('viewer')
    const res = await app.handle(
      request('/api/v0/networks/some-network/members/leaf-1', 'DELETE', 'viewer-token')
    )
    expect(res.status).toBe(403)
  })

  it('admin updates network metadata through the facade', async () => {
    const app = createApp('admin')
    await app.handle(
      request('/api/v0/networks', 'POST', 'admin-token', { name: 'metadata-network' })
    )
    const listRes = await app.handle(request('/api/v0/networks', 'GET', 'admin-token'))
    const list = (await listRes.json()) as { networks: Array<{ id: string; name: string }> }
    const target = list.networks.find(network => network.name === 'metadata-network')
    expect(target).toBeDefined()

    const res = await app.handle(
      request(`/api/v0/networks/${target!.id}`, 'PATCH', 'admin-token', {
        displayName: '运维主网络'
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { network: { displayName?: string } }
    expect(body.network.displayName).toBe('运维主网络')
  })

  it('facade routes require a bearer token', async () => {
    const app = createApp('admin')
    const res = await app.handle(
      new Request('http://localhost/api/v0/networks/some-network', { method: 'DELETE' })
    )
    expect(res.status).toBe(401)
  })
})
