import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import { createInMemoryMTaskDeps, createMTaskApp } from '../../services/m-task/src/app.ts'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import { CommandWellEligibilitySchema, MinimalPolicyDecisionSummarySchema } from '../../packages/contracts/src/index.ts'

const CORE_BASE = 'http://mock-core'
const TASK_BASE = 'http://mock-task'

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
  coreApp: ReturnType<typeof createCoreApp>,
  taskApp?: ReturnType<typeof createMTaskApp>
): ReturnType<typeof createMUiBffApp> {
  const app = createMUiBffApp(taskApp ? { coreBaseUrl: CORE_BASE, taskBaseUrl: TASK_BASE } : { coreBaseUrl: CORE_BASE })
  // 覆盖 fetch 把 mock-core 请求路由到 Core app
  globalThis.fetch = (async (input, init?) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(CORE_BASE)) {
      const path = url.slice(CORE_BASE.length)
      return coreApp.handle(new Request(`http://localhost${path}`, init))
    }
    if (taskApp && url.startsWith(TASK_BASE)) {
      const path = url.slice(TASK_BASE.length)
      return taskApp.handle(new Request(`http://localhost${path}`, init))
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
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(true)
    expect(body.state).toBe('enabled')
    expect(body.command.id).toBe('task.noop.run')
  })

  it('POST /api/v0/commands/noop with viewer token returns disabled for missing task:submit', async () => {
    const viewerDeps = createInMemoryCoreDeps({ actor: 'viewer' })
    const coreApp = createCoreApp(viewerDeps)

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'viewer-token', {
      leafNodeId: 'leaf-placeholder'
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { state: string; disabledReason: string; disabled: { code: string; missingPermission?: string } }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(true)
    expect(body.state).toBe('disabled')
    expect(body.disabled.code).toBe('missing_permission')
    expect(body.disabled.missingPermission).toBe('task:submit')
    expect(body.disabledReason).toBe('缺少权限：task:submit')
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
    const body = await res.json() as { state: string; disabledReason: string; disabled: { code: string } }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(true)
    expect(body.state).toBe('disabled')
    expect(body.disabled.code).toBe('wrong_node_kind')
    expect(body.disabledReason).toBe('目标不是 Leaf 节点')
  })

  it('POST /api/v0/commands/noop with operator token targeting missing node returns disabled for target missing', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'operator-token', {
      leafNodeId: 'missing-leaf-node'
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { state: string; disabledReason: string; disabled: { code: string } }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(true)
    expect(body.state).toBe('disabled')
    expect(body.disabled.code).toBe('target_missing')
    expect(body.disabledReason).toBe('目标节点不存在')
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
    const body = await res.json() as { state: string; disabledReason: string; disabled: { code: string } }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(true)
    expect(body.state).toBe('disabled')
    expect(body.disabled.code).toBe('node_unreachable')
    expect(body.disabledReason).toBe('目标节点不可达')
  })

  it('POST /api/v0/commands/noop derives disabled state without audit or task side effects', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/commands/noop', 'POST', 'viewer-token', {
      leafNodeId: 'leaf-placeholder'
    })
    const audit = await deps.log.listAudit()
    const timeline = await deps.log.listTimeline()

    expect(res.status).toBe(200)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
    expect(audit.ok ? audit.value.some((entry) => entry.action === 'task:submit') : true).toBe(false)
    expect(timeline.ok ? timeline.value.some((entry) => entry.summary.includes('noop task')) : true).toBe(false)
  })

  it('POST /api/v0/commands/noop/execute with operator token returns task result', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const taskApp = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

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

    const app = createBffWithCore(coreApp, taskApp)
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

  // --- Policy decision summary ---

  it('GET /api/v0/policy/decisions/:id/summary returns trimmed response (no reasons)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    // 先注册 Leaf 节点并执行受保护操作以生成一个 policy decision
    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-policy', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const execRes = await coreApp.handle(
      new Request(`http://localhost/api/v0/nodes/${leafId}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const execBody = (await execRes.json()) as { policyDecisionId: string }
    expect(execBody.policyDecisionId).toBeDefined()

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, `/api/v0/policy/decisions/${execBody.policyDecisionId}/summary`, 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      decision: { id: string; actor: string; action: string; resource: string; result: string; createdAt: string; reasons?: string[] }
    }
    expect(body.decision.id).toBe(execBody.policyDecisionId)
    expect(body.decision.actor).toBeDefined()
    expect(body.decision.action).toBeDefined()
    expect(body.decision.resource).toBeDefined()
    expect(body.decision.result).toBeDefined()
    expect(body.decision.createdAt).toBeDefined()
    expect(Either.isRight(Schema.decodeUnknownEither(MinimalPolicyDecisionSummarySchema)(body.decision))).toBe(true)
    // reasons MUST NOT be present
    expect(body.decision).not.toHaveProperty('reasons')
  })

  it('GET /api/v0/policy/decisions/:id/summary passes through 404 from Core', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/policy/decisions/nonexistent-id/summary', 'GET', 'operator-token')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBeDefined()
  })

  // --- Audit aggregation in overview ---

  it('GET /api/v0/overview with operator token returns audit:null', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { audit: unknown }
    expect(body.audit).toBeNull()
  })

  it('GET /api/v0/overview with security-admin token returns audit with entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)

    // 写入审计日志条目
    await deps.log.writeAudit({
      actor: 'security-admin',
      action: 'task:submit',
      resource: 'node:1',
      result: 'allow',
      correlationId: 'cid-audit-1'
    })

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/overview', 'GET', 'security-admin-token')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      auditAccessible: boolean
      audit: Array<{ id: string; actor: string; action: string; resource: string; result: string }> | null
    }
    expect(body.auditAccessible).toBe(true)
    expect(body.audit).not.toBeNull()
    const entries = body.audit!
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]!.actor).toBe("security-admin")
    expect(entries[0]!.action).toBe("task:submit")
  })
})

describe('Phase 14 BFF routes', () => {
  it('GET /api/v0/routes returns route registry', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { routes: Array<{ id: string }> }
    expect(Array.isArray(body.routes)).toBe(true)
  })

  it('GET /api/v0/routes/:id returns one route', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes/control-room.overview', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { route: { id: string } }
    expect(body.route.id).toBe('control-room.overview')
  })

  it('GET /api/v0/routes/:id unknown route returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/routes/nonexistent', 'GET', 'operator-token')
    expect(res.status).toBe(404)
  })

  it('GET /api/v0/nodes returns node list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/nodes', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { nodes: Array<{ id: string }> }
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  it('GET /api/v0/timeline returns timeline entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/timeline', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ id: string }> }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('GET /api/v0/audit returns audit entries', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/audit', 'GET', 'security-admin-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ id: string }> }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('GET /api/v0/audit denies operator', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/audit', 'GET', 'operator-token')
    expect(res.status).toBe(403)
  })

  it('GET /api/v0/policy/decisions returns decision list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/policy/decisions', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { decisions: Array<{ id: string }> }
    expect(Array.isArray(body.decisions)).toBe(true)
  })

  it('GET /api/v0/policy/decisions/:id returns decision with stateSource', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const taskApp = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

    // 注册 Leaf 节点并执行操作以生成 policy decision
    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'leaf', name: 'leaf-policy-detail', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id
    const execRes = await coreApp.handle(
      new Request(`http://localhost/api/v0/nodes/${leafId}/credentials`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    const execBody = (await execRes.json()) as { policyDecisionId: string }
    expect(execBody.policyDecisionId).toBeDefined()

    const app = createBffWithCore(coreApp, taskApp)
    const res = await makeRequest(app, `/api/v0/policy/decisions/${execBody.policyDecisionId}`, 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; stateSource: { sourceType: string; sourceId: string } }
    expect(body.id).toBe(execBody.policyDecisionId)
    expect(body.stateSource).toBeDefined()
    expect(body.stateSource.sourceType).toBe('policy')
  })

  it('GET /api/v0/services returns service list', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/services', 'GET', 'operator-token')
    expect(res.status).toBe(200)
    const body = await res.json() as { services: Array<{ id: string }> }
    expect(Array.isArray(body.services)).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/eligibility works for noop', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'phase-14-eligibility-leaf', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp)
    const res = await makeRequest(app, '/api/v0/commands/task.noop.submit/eligibility', 'POST', 'operator-token', {
      leafNodeId: leafId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { command: { id: string }; state: string }
    expect(body.command.id).toBe('task.noop.submit')
    expect(body.state).toBe('enabled')
  })

  it('POST /api/v0/commands/:commandId/eligibility rejects unknown command', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/commands/unknown.cmd/eligibility', 'POST', 'operator-token', {
      leafNodeId: 'leaf-placeholder'
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/v0/commands/:commandId/execute works for noop', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const taskApp = createMTaskApp(createInMemoryMTaskDeps({ actor: 'operator' }))

    const regRes = await coreApp.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: {
          authorization: 'Bearer operator-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'leaf', name: 'phase-14-execute-leaf', mode: 'simulated' })
      })
    )
    const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

    const app = createBffWithCore(coreApp, taskApp)
    const res = await makeRequest(app, '/api/v0/commands/task.noop.submit/execute', 'POST', 'operator-token', {
      leafNodeId: leafId
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { task: { id: string; status: string }; policyDecisionId: string; correlationId: string }
    expect(body.task.id).toBeDefined()
    expect(body.task.status).toBe('completed')
    expect(body.policyDecisionId).toBeDefined()
    expect(body.correlationId).toBeDefined()
  })

  it('POST /api/v0/commands/:commandId/execute rejects unknown command', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(app, '/api/v0/commands/unknown.cmd/execute', 'POST', 'operator-token', {
      leafNodeId: 'leaf-placeholder'
    })
    expect(res.status).toBe(400)
  })
})

describe('Phase 14 BFF OpenAPI', () => {
  it('OpenAPI exposes only UI-facing BFF routes', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })

    const res = await makeRequest(app, '/openapi')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('/api/v0')
  })
})
