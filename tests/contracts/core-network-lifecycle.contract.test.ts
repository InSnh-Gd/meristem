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
    if (!target) throw new Error('lifecycle-network missing from list response')

    const res = await app.handle(request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { networkId: string }
    expect(body.networkId).toBe(target.id)
  })

  it('DELETE is idempotent: a retried delete of a gone network republishes the deletion event', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    const published: Array<{ subject: string; payload: unknown }> = []
    const originalPublish = deps.events.publish
    deps.events.publish = async (subject: string, ...rest: unknown[]) => {
      published.push({ subject, payload: (rest[0] as { payload: unknown }).payload })
      return originalPublish(subject as never, rest[0] as never)
    }
    const app = createCoreApp(deps)
    await app.handle(
      request('/api/v0/networks', 'POST', 'admin-token', { name: 'idempotent-network' })
    )
    const listRes = await app.handle(request('/api/v0/networks', 'GET', 'admin-token'))
    const list = (await listRes.json()) as { networks: Array<{ id: string; name: string }> }
    const target = list.networks.find(network => network.name === 'idempotent-network')
    if (!target) throw new Error('idempotent-network missing from list response')

    const first = await app.handle(
      request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token')
    )
    expect(first.status).toBe(200)
    // 模拟「删除已提交、事件发布失败」后的重试：端口返回 network.not_found。
    const depsWithGonePort = {
      ...deps,
      mNet: {
        ...deps.mNet,
        deleteNetwork: async () => ({
          ok: false as const,
          error: { code: 'network.not_found', message: 'network not found' }
        })
      }
    }
    const retryApp = createCoreApp(depsWithGonePort)
    const retry = await retryApp.handle(
      request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token')
    )

    expect(retry.status).toBe(200)
    const retryBody = (await retry.json()) as { networkId: string }
    expect(retryBody.networkId).toBe(target.id)
    const deletedEvents = published.filter(entry => entry.subject === 'mnet.network.deleted.v0')
    expect(deletedEvents).toHaveLength(2)
    // 首次删除不带 replayed；补发路径带 replayed=true，消费者可区分并对账。
    expect(deletedEvents[0]?.payload).toEqual({ networkId: target.id })
    expect(deletedEvents[1]?.payload).toEqual({ networkId: target.id, replayed: true })
  })

  it('DELETE surfaces event publish failure as typed 503 instead of a false success', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    deps.events.publish = async () => ({
      ok: false as const,
      error: { code: 'eventbus.unavailable', message: 'M-EventBus unavailable' }
    })
    const app = createCoreApp(deps)
    await app.handle(
      request('/api/v0/networks', 'POST', 'admin-token', { name: 'publish-fail-network' })
    )
    const listRes = await app.handle(request('/api/v0/networks', 'GET', 'admin-token'))
    const list = (await listRes.json()) as { networks: Array<{ id: string; name: string }> }
    const target = list.networks.find(network => network.name === 'publish-fail-network')
    if (!target) throw new Error('publish-fail-network missing from list response')

    const res = await app.handle(request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token'))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('eventbus.unavailable')
  })

  it('DELETE maps typed ledger conflicts to 409', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    const depsWithConflict = {
      ...deps,
      mNet: {
        ...deps.mNet,
        deleteNetwork: async () => ({
          ok: false as const,
          error: {
            code: 'network.closed_loop_facts_present',
            message: 'network still has closed-loop facts; prune them before deletion'
          }
        })
      }
    }
    const app = createCoreApp(depsWithConflict)

    const res = await app.handle(request('/api/v0/networks/any-network', 'DELETE', 'admin-token'))
    expect(res.status).toBe(409)
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
    if (!target) throw new Error('metadata-network missing from list response')

    const res = await app.handle(
      request(`/api/v0/networks/${target.id}`, 'PATCH', 'admin-token', {
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
