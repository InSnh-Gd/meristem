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

/** 构建同时暴露已写审计事实的应用，用于断言「变更前写 Audit」的边界。 */
function createAppWithAudit(actor: ActorId): {
  app: CoreApp
  audits: Array<{ action: string; resource: string }>
} {
  const { deps } = createCoreDepsWithWriters({ actor })
  const audits: Array<{ action: string; resource: string }> = []
  const originalWriteAudit = deps.log.writeAudit.bind(deps.log)
  // 包装审计端口以捕获事实；内部实现不变，仅记录调用。
  deps.log.writeAudit = async input => {
    audits.push({ action: input.action, resource: input.resource })
    return originalWriteAudit(input)
  }
  return { app: createCoreApp(deps), audits }
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

  it('DELETE is idempotent for an already-deleted network: M-Net tombstone yields 200 without a Core publish', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    const published: Array<{ subject: string }> = []
    const originalPublish = deps.events.publish
    deps.events.publish = async (subject: string, ...rest: unknown[]) => {
      published.push({ subject })
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
    // 模拟「删除已提交（墓碑已写）」后的重试：M-Net 端口按墓碑返回成功。
    const depsWithTombstone = {
      ...deps,
      mNet: {
        ...deps.mNet,
        deleteNetwork: async () => ({ ok: true as const, value: { networkId: target.id } })
      }
    }
    const retryApp = createCoreApp(depsWithTombstone)
    const retry = await retryApp.handle(
      request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token')
    )

    expect(retry.status).toBe(200)
    const retryBody = (await retry.json()) as { networkId: string }
    expect(retryBody.networkId).toBe(target.id)
    // ADR-N05：Core 不再内联发布网络生命周期事件；事件由 M-Net outbox 负责。
    expect(published.filter(entry => entry.subject === 'mnet.network.deleted.v0')).toHaveLength(0)
  })

  it('DELETE maps a never-existing network (no tombstone) to 404 instead of a false success', async () => {
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
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
    const app = createCoreApp(depsWithGonePort)

    const res = await app.handle(request('/api/v0/networks/never-existed', 'DELETE', 'admin-token'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('network.not_found')
  })

  it('DELETE succeeds without an event publish dependency — publication is M-Net-side now', async () => {
    // ADR-N05：发布失败不再把已提交的删除翻成 503；Core 只写 Timeline（失败降级 warn）。
    const { deps } = createCoreDepsWithWriters({ actor: 'admin' })
    deps.events.publish = async () => {
      throw new Error('M-EventBus unavailable')
    }
    const app = createCoreApp(deps)
    await app.handle(
      request('/api/v0/networks', 'POST', 'admin-token', { name: 'publish-fail-network' })
    )
    const listRes = await app.handle(request('/api/v0/networks', 'GET', 'admin-token'))
    const list = (await listRes.json()) as { networks: Array<{ id: string; name: string }> }
    const target = list.networks.find(network => network.name === 'publish-fail-network')
    if (!target) throw new Error('publish-fail-network missing from list response')

    const res = await app.handle(request(`/api/v0/networks/${target.id}`, 'DELETE', 'admin-token'))
    expect(res.status).toBe(200)
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
    const { app, audits } = createAppWithAudit('admin')
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
    // metadata 变更同样是权威状态写入，必须与 create/join/delete 一样在变更前写 Audit。
    expect(audits).toContainEqual({
      action: 'network:create',
      resource: `network:${target.id}`
    })
  })

  it('facade routes require a bearer token', async () => {
    const app = createApp('admin')
    const res = await app.handle(
      new Request('http://localhost/api/v0/networks/some-network', { method: 'DELETE' })
    )
    expect(res.status).toBe(401)
  })
})
