import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

const CORE_BASE = 'http://mock-core'

// 覆盖全局 fetch: 把指向 mock-core 的请求路由到 Core app.handle()
let originalFetch: typeof globalThis.fetch

beforeAll(async () => {
  // 保存原始 fetch 供 afterAll 恢复
  originalFetch = globalThis.fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function makeRequest(
  app: ReturnType<typeof createMUiBffApp>,
  path: string,
  method: string = 'GET',
  token?: string,
  body?: unknown
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.handle(new Request(`http://localhost${path}`, init))
}

// 创建一个指向特定 Core 实例的 BFF app
function createBffWithCore(
  coreApp: ReturnType<typeof createCoreApp>
): ReturnType<typeof createMUiBffApp> {
  const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
  // 覆盖 fetch 把 mock-core 请求路由到 Core app
  globalThis.fetch = (async (input, init?) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(CORE_BASE)) {
      const path = url.slice(CORE_BASE.length)
      return coreApp.handle(new Request(`http://localhost${path}`, init))
    }
    return originalFetch(input, init)
  }) as typeof globalThis.fetch
  return app
}

describe('M-UI BFF contract tests', () => {
  it('GET /health returns ok', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; service: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('m-ui-bff')
  })

  it('GET /ready returns ready:true when Core is up', async () => {
    const coreApp = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/ready')
    expect(res.status).toBe(200)
    const body = await res.json() as { ready: boolean }
    expect(body.ready).toBe(true)
  })

  it('GET /api/v0/overview with operator token returns correct shape', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    // 注册几个节点并写入 timeline
    await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-1', mode: 'simulated' })
      })
    )
    await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'stem', name: 'stem-1', mode: 'simulated' })
      })
    )
    await deps.log.writeTimeline({ summary: 'test log', correlationId: 'cid-1' })

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      session: { actor: string; permissions: string[] }
      core: { id: string; version: string; mode: string }
      nodes: Array<{ id: string }>
      services: Array<{ id: string }>
      timeline: Array<{ id: string }>
      auditAccessible: boolean
    }
    expect(body.session.actor).toBe('operator')
    expect(body.nodes).toHaveLength(2)
    expect(body.timeline.length).toBeGreaterThanOrEqual(1)
    expect(body.auditAccessible).toBe(false)
  })

  it('GET /api/v0/overview with viewer token returns auditAccessible:false', async () => {
    const viewerDeps = createInMemoryCoreDeps({ actor: 'viewer' })
    const viewerApp = createCoreApp(viewerDeps)
    const app = createBffWithCore(viewerApp)

    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'viewer-token')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      session: { actor: string; permissions: string[] }
      auditAccessible: boolean
    }
    expect(body.session.actor).toBe('viewer')
    expect(body.auditAccessible).toBe(false)
  })

  it('GET /api/v0/overview without token returns error', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/api/v0/overview')
    expect(res.status).toBe(401)
  })

  it('does not expose auth header debug routes from the public BFF', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })
    const res = await makeRequest(app, '/api/v0/debug/headers', 'GET', 'operator-token')
    expect(res.status).toBe(404)
  })

  it('GET /api/v0/nodes/:id returns node data', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-1', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, `/api/v0/nodes/${leafId}`, 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      node: { id: string; kind: string; name: string }
    }
    expect(body.node.id).toBe(leafId)
    expect(body.node.kind).toBe('leaf')
  })

  it('POST /api/v0/commands/noop with operator token targeting leaf returns enabled', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-cmd', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'operator-token', {
      leafNodeId: leafId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      state: string
      command: { id: string }
    }
    expect(body.state).toBe('enabled')
    expect(body.command.id).toBe('task.noop.run')
  })

  it('POST /api/v0/commands/noop with viewer token returns disabled for missing task:assign', async () => {
    const viewerDeps = createInMemoryCoreDeps({ actor: 'viewer' })
    const coreApp = createCoreApp(viewerDeps)

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'viewer-token', {
      leafNodeId: 'leaf-placeholder'
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { state: string; disabledReason: string }
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('缺少权限：task:assign')
  })

  it('POST /api/v0/commands/noop with operator token targeting stem returns disabled for wrong kind', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'stem', name: 'stem-target', mode: 'simulated' })
      })
    )
    const stemId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'operator-token', {
      leafNodeId: stemId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { state: string; disabledReason: string }
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('目标不是 Leaf 节点')
  })

  it('POST /api/v0/commands/noop with operator token targeting offline leaf returns disabled for unreachable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'offline-target', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const testingDeps = deps as ReturnType<typeof createInMemoryCoreDeps> & {
      __testing: {
        setNodeRuntime(nodeId: string, patch: { status?: string; reachability?: string }): void
      }
    }
    testingDeps.__testing.setNodeRuntime(leafId, { reachability: 'unreachable' })

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'operator-token', {
      leafNodeId: leafId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { state: string; disabledReason: string }
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('目标节点不可达')
  })

  it('POST /api/v0/commands/noop/execute with operator token returns task result', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-exec', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop/execute', 'POST', 'operator-token', {
      leafNodeId: leafId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      task: { id: string; status: string }
      policyDecisionId: string
      correlationId: string
    }
    expect(body.task.id).toBeDefined()
    expect(body.task.status).toBe('completed')
    expect(body.policyDecisionId).toBeDefined()
    expect(body.correlationId).toBeDefined()
  })
})
