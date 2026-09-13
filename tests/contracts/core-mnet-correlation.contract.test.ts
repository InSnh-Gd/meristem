import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHttpMNetPort } from '../../apps/core/src/adapters/http-mnet.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'

/**
 * Core -> M-Net 成员移除端口的 correlationId 透传契约。
 * Core 侧审计用 auth.correlationId，M-Net 侧 map 刷新/事件必须收到同一个值；
 * 本测试用真实 HTTP 边界证明 Eden 的 headers 选项确实被发出，而不是只断言本地函数入参。
 */

const originalInternalToken = process.env.MERISTEM_INTERNAL_TOKEN
const originalMNetUrl = process.env.MERISTEM_MNET_URL

type Served = {
  url: string
  stop(): void
}

const served: Served[] = []

function startMNetStub(handler: (request: Request) => Response | Promise<Response>): Served {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
  const app = { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
  served.push(app)
  return app
}

describe('Core -> M-Net member removal correlationId passthrough', () => {
  beforeEach(() => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'core-mnet-correlation-test-token'
  })

  afterEach(() => {
    while (served.length > 0) served.pop()?.stop()
    if (originalInternalToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
    else process.env.MERISTEM_INTERNAL_TOKEN = originalInternalToken
    if (originalMNetUrl === undefined) delete process.env.MERISTEM_MNET_URL
    else process.env.MERISTEM_MNET_URL = originalMNetUrl
  })

  it('sends the caller correlationId as x-correlation-id on the internal member DELETE', async () => {
    const seen: Array<{ path: string; correlationId: string | null; token: string | null }> = []
    const stub = startMNetStub(request => {
      const url = new URL(request.url)
      seen.push({
        path: url.pathname,
        correlationId: request.headers.get('x-correlation-id'),
        token: request.headers.get(internalTokenHeaderName)
      })
      return Response.json({ networkId: 'network-1', nodeId: 'leaf-1' })
    })
    process.env.MERISTEM_MNET_URL = stub.url

    const port = createHttpMNetPort()
    const result = await port.removeMember({
      networkId: 'network-1',
      nodeId: 'leaf-1',
      correlationId: 'corr-core-1'
    })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-1', nodeId: 'leaf-1' } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe('/internal/v0/networks/network-1/members/leaf-1')
    expect(seen[0]?.correlationId).toBe('corr-core-1')
    // 内部 token 认证边界不受 correlationId 透传影响。
    expect(seen[0]?.token).toBe('core-mnet-correlation-test-token')
  })

  it('maps a 404 member-not-found response to a typed service error', async () => {
    const stub = startMNetStub(() =>
      Response.json(
        { error: { code: 'network.member_not_found', message: 'node is not a network member' } },
        { status: 404 }
      )
    )
    process.env.MERISTEM_MNET_URL = stub.url

    const port = createHttpMNetPort()
    const result = await port.removeMember({
      networkId: 'network-1',
      nodeId: 'leaf-1',
      correlationId: 'corr-core-2'
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'network.member_not_found', message: 'node is not a network member' }
    })
  })
})
