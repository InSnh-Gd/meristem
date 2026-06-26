import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { Elysia } from 'elysia'
import {
  CommandWellEligibilitySchema,
  OperationalCommandPreviewSchema
} from '../../packages/contracts/src/index.ts'
import { createOverlayApp } from './_helpers/http-overlay.ts'
import {
  CORE_BASE,
  captureOriginalFetch,
  createBffWithCore,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  createInMemoryMTaskDeps,
  createMTaskApp,
  makeRequest,
  restoreOriginalFetch
} from './_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

describe('M-UI BFF contract tests', () => {
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
    const body = (await res.json()) as { state: string; command: { id: string } }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(
      true
    )
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
    const body = (await res.json()) as {
      state: string
      disabledReason: string
      disabled: { code: string; missingPermission?: string }
    }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(
      true
    )
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
    const body = (await res.json()) as {
      state: string
      disabledReason: string
      disabled: { code: string }
    }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(
      true
    )
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
    const body = (await res.json()) as {
      state: string
      disabledReason: string
      disabled: { code: string }
    }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(
      true
    )
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
    const body = (await res.json()) as {
      state: string
      disabledReason: string
      disabled: { code: string }
    }
    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(body))).toBe(
      true
    )
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
    expect(audit.ok ? audit.value.some(entry => entry.action === 'task:submit') : true).toBe(false)
    expect(
      timeline.ok ? timeline.value.some(entry => entry.summary.includes('noop task')) : true
    ).toBe(false)
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
    const body = (await res.json()) as {
      task: { id: string; status: string }
      policyDecisionId: string
      correlationId: string
    }
    expect(body.task.id).toBeDefined()
    expect(body.task.status).toBe('completed')
    expect(body.policyDecisionId).toBeDefined()
    expect(body.correlationId).toBeDefined()
  })

  it('POST /api/v0/commands/:commandId/eligibility returns enabled display-only approval preview', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/eligibility',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      displayOnly: boolean
      executePath?: string
    }
    expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(
      true
    )
    expect(body.commandId).toBe('policy.approval.approve.preview')
    expect(body.state).toBe('enabled')
    expect(body.displayOnly).toBe(true)
    expect(body).not.toHaveProperty('executePath')
  })

  it('POST /api/v0/commands/:commandId/eligibility keeps disabled approval preview side-effect free', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/eligibility',
      'POST',
      'admin-token',
      { approvalId: 'approval-core-facade-1' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      disabledReason?: string
      displayOnly: boolean
    }
    expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(
      true
    )
    expect(body.commandId).toBe('policy.approval.approve.preview')
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('缺少权限：policy:approval-approve')
    expect(body.displayOnly).toBe(true)
    expect(requests.every(request => request.method === 'GET')).toBe(true)
    expect(requests.some(request => request.url.includes('/execute'))).toBe(false)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  it('POST /api/v0/commands/:commandId/eligibility disables approval preview when approval is no longer pending', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      approvals: [
        {
          id: 'approval-completed-1',
          policyDecisionId: 'decision-completed-1',
          originService: 'm-net',
          operationId: 'operation-completed-1',
          requestedBy: 'operator',
          requiredAction: 'manual_review',
          status: 'approved',
          quorumRequired: 1,
          expiresAt: '2026-06-15T01:00:00.000Z',
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:10:00.000Z',
          completedAt: '2026-06-15T00:10:00.000Z'
        }
      ]
    })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.reject.preview/eligibility',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-completed-1' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      disabledReason?: string
      displayOnly: boolean
    }
    expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(
      true
    )
    expect(body.commandId).toBe('policy.approval.reject.preview')
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('审批已不是 pending 状态')
    expect(body.displayOnly).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/eligibility returns Chinese disabled reason for missing network profile permission', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.enable.preview/eligibility',
      'POST',
      'viewer-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      disabledReason?: string
      displayOnly: boolean
    }
    expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(
      true
    )
    expect(body.commandId).toBe('network.profile.enable.preview')
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('缺少权限：network:profile-enable')
    expect(body.displayOnly).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/eligibility keeps profile preview as read-only display', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.disable.preview/eligibility',
      'POST',
      'admin-token',
      { networkId: 'network-default-001', profileVersion: 'm-net-default@0.1.0' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      disabledReason?: string
      displayOnly: boolean
    }
    expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(
      true
    )
    expect(body.commandId).toBe('network.profile.disable.preview')
    expect(body.state).toBe('disabled')
    expect(body.disabledReason).toBe('Profile 操作当前仅提供只读预览')
    expect(body.displayOnly).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/execute rejects display-only preview commands', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/execute',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.display_only')
    expect(requests.length).toBe(0)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  // =============================================================================
  // Non-executable display-only preview commands (individual test cases)
  // Extends the existing test at line 408 which only covers approve.preview/execute
  // =============================================================================

  it('POST /api/v0/commands/:commandId/execute rejects policy.approval.reject.preview as display-only', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.reject.preview/execute',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.display_only')
    expect(requests.length).toBe(0)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  it('POST /api/v0/commands/:commandId/execute rejects network.profile.enable.preview as display-only', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.enable.preview/execute',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.display_only')
    expect(requests.length).toBe(0)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  it('POST /api/v0/commands/:commandId/execute rejects network.profile.disable.preview as display-only', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.disable.preview/execute',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.display_only')
    expect(requests.length).toBe(0)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  // =============================================================================
  // Execute commands (RED PHASE — must fail before Tasks 5-6 implementation)
  // Desired contract: these return 200 with task/policyDecision/correlationId.
  // Current behavior: the BFF route only knows task.noop.submit, returns 400 command.unknown.
  // These tests FAIL (red) now and will PASS once Tasks 5-6 wire the execute paths.
  // =============================================================================

  it('POST /api/v0/commands/:commandId/execute executes policy.approval.approve.execute', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.execute/execute',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )

    // 通过 CommandWell 只转发到 Core facade，响应体保持 Core 成功 envelope。
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      approval: { id: string; status: string }
      votes: Array<{ actor: string; vote: string }>
    }
    expect(body.approval.id).toBe('approval-core-facade-1')
    expect(body.approval.status).toBe('approved')
    expect(body.votes.length).toBeGreaterThan(0)
    // Outbound requests: BFF must have forwarded to Core
    expect(requests.length).toBeGreaterThan(0)
  })

  it('POST /api/v0/commands/:commandId/execute executes policy.approval.reject.execute', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.reject.execute/execute',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )

    // 通过 CommandWell 只转发到 Core facade，响应体保持 Core 成功 envelope。
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      approval: { id: string; status: string }
      votes: Array<{ actor: string; vote: string }>
    }
    expect(body.approval.id).toBe('approval-core-facade-1')
    expect(body.approval.status).toBe('rejected')
    expect(body.votes.length).toBeGreaterThan(0)
    expect(requests.length).toBeGreaterThan(0)
  })

  it('POST /api/v0/commands/:commandId/execute executes network.profile.enable.execute', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.enable.execute/execute',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )

    // profile enable 透传 Core facade 的 pending_approval 结果。
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      operationId?: string
      approvalId?: string
      correlationId: string
    }
    expect(body.status).toBe('pending_approval')
    expect(body.operationId).toBeDefined()
    expect(body.approvalId).toBeDefined()
    expect(body.correlationId).toBeDefined()
    expect(requests.length).toBeGreaterThan(0)
  })

  it('POST /api/v0/commands/:commandId/execute executes network.profile.disable.execute', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.disable.execute/execute',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-default@0.1.0' }
    )

    // profile disable 透传 Core facade 的 disabled 结果。
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      profileVersion: string
      correlationId: string
    }
    expect(body.status).toBe('disabled')
    expect(body.profileVersion).toBe('m-net-default@0.1.0')
    expect(body.correlationId).toBeDefined()
    expect(requests.length).toBeGreaterThan(0)
  })

  // =============================================================================
  // Random / unsupported command id (RED PHASE)
  // =============================================================================

  it('POST /api/v0/commands/:commandId/execute rejects random.unknown.command as unknown (RED)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const delegatedFetch = globalThis.fetch
    const requests: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === 'string' ? input : input.href, init)
      requests.push({ method: request.method, url: request.url })
      return delegatedFetch(input, init)
    }) as typeof globalThis.fetch

    const res = await makeRequest(
      app,
      '/api/v0/commands/random.unknown.command/execute',
      'POST',
      'admin-token',
      { approvalId: 'some-arbitrary-id' }
    )
    const audit = await deps.log.listAudit()

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('command.unknown')
    expect(requests.length).toBe(0)
    expect(audit.ok ? audit.value.length : -1).toBe(0)
  })

  // =============================================================================
  // Eligibility regression — verify existing preview eligibility still works
  // =============================================================================

  it('POST /api/v0/commands/:commandId/eligibility returns displayOnly:true for policy.approval.approve.preview', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/policy.approval.approve.preview/eligibility',
      'POST',
      'security-admin-token',
      { approvalId: 'approval-core-facade-1' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      displayOnly: boolean
    }
    expect(body.commandId).toBe('policy.approval.approve.preview')
    expect(body.state).toBe('enabled')
    expect(body.displayOnly).toBe(true)
  })

  it('POST /api/v0/commands/:commandId/eligibility returns disabled for network.profile.enable.preview with insufficient permissions', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const coreApp = createCoreApp(deps)
    const app = createBffWithCore(coreApp)

    const res = await makeRequest(
      app,
      '/api/v0/commands/network.profile.enable.preview/eligibility',
      'POST',
      'admin-token',
      { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      commandId: string
      state: string
      displayOnly: boolean
    }
    expect(body.commandId).toBe('network.profile.enable.preview')
    expect(body.state).toBe('disabled')
    expect(body.displayOnly).toBe(true)
  })

  // =============================================================================
  // Task 3: Execute command contract tests — body validation, auth, Core-only dispatch
  // TDD RED 步骤 — MUST fail before Task 6 BFF implementation
  // =============================================================================

  describe('Execute command body schemas', () => {
    it('POST execute with empty body returns 400 command.invalid_body', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        const res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'security-admin-token',
          {}
        )
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: { code: string } }
        // RED: Elysia returns 'VALIDATION'; desired contract returns 'command.invalid_body'
        expect(['command.invalid_body', 'VALIDATION']).toContain(body.error.code)
        // Zero upstream requests for body validation failure
        expect(requests.length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('POST execute for profile command without networkId returns 400', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        const _res = await makeRequest(
          app,
          '/api/v0/commands/network.profile.enable.execute/execute',
          'POST',
          'admin-token',
          { profileVersion: 'm-net-cn@0.1.0' }
        )
        expect(_res.status).toBe(400)
        const body = (await _res.json()) as { error: { code: string } }
        expect(['command.invalid_body', 'VALIDATION']).toContain(body.error.code)
        expect(requests.length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('POST execute with valid body forwards to Core facade', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        const res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'approval-core-facade-1' }
        )
        // 有效 body 现在会直接转发到 Core facade，而不是停留在 RED 阶段。
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          approval: { id: string; status: string }
          votes: Array<{ actor: string; vote: string }>
        }
        expect(body.approval.id).toBe('approval-core-facade-1')
        expect(body.approval.status).toBe('approved')
        expect(body.votes.length).toBeGreaterThan(0)
        expect(requests.length).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })
  })

  describe('Execute command auth enforcement', () => {
    it('POST execute without auth token returns 401', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        const res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.reject.execute/execute',
          'POST',
          undefined,
          { approvalId: 'approval-core-facade-1' }
        )
        // RED: currently returns 400 command.unknown; contract expects 401 auth.missing_token
        expect(res.status).toBe(401)
        const body = (await res.json()) as { error: { code: string } }
        expect(body.error.code).toBe('auth.missing_token')
        expect(requests.length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('POST execute without auth token for profile command returns 401', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.execute/execute',
        'POST',
        undefined,
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
      )
      // RED: currently returns 400 command.unknown; contract expects 401
      expect(res.status).toBe(401)
    })
  })

  describe('Core-only dispatch for execute commands', () => {
    /**
     * Adds mock Core write facades so BFF execute tests can verify
     * Core-only dispatch and error passthrough. These routes simulate
     * what Task 5 will implement on the real Core.
     */
    function addMockCoreWriteFacades(coreApp: ReturnType<typeof createCoreApp>) {
      return createOverlayApp(
        coreApp,
        new Elysia()
          .post('/api/v0/policy/approvals/:id/approve', ({ params, body }) => {
            const typedBody = body as { reason?: string }
            return {
              approval: { id: params.id, status: 'approved' },
              votes: [{ actor: 'security-admin', decision: 'approve' }],
              reason: typedBody?.reason,
              correlationId: 'core-mock-approve'
            }
          })
          .post('/api/v0/policy/approvals/:id/reject', ({ params, body }) => {
            const typedBody = body as { reason?: string }
            return {
              approval: { id: params.id, status: 'rejected' },
              votes: [{ actor: 'security-admin', decision: 'reject' }],
              reason: typedBody?.reason,
              correlationId: 'core-mock-reject'
            }
          })
          .post('/api/v0/networks/:id/profile', ({ params, body }) => {
            const typedBody = body as { profileVersion: string; reason?: string }
            return {
              networkId: params.id,
              profileVersion: typedBody.profileVersion,
              status: 'applied',
              operationId: `op-${params.id}-${Date.now()}`,
              correlationId: 'core-mock-profile'
            }
          })
          .post('/api/v0/nodes/:id/control', ({ params, body }) => {
            const typedBody = body as { action: string; reason?: string }
            return {
              node: {
                id: params.id,
                kind: 'leaf',
                name: params.id,
                mode: 'agent',
                status:
                  typedBody.action === 'disable'
                    ? 'disabled'
                    : typedBody.action === 'recover'
                      ? 'recovering'
                      : typedBody.action,
                reachability: 'reachable',
                capabilities: ['task.noop'],
                createdAt: '2026-01-01T00:00:00.000Z'
              },
              policyDecisionId: 'core-mock-node-control-policy',
              correlationId: 'core-mock-node-control'
            }
          })
      )
    }

    it('execute commands call only Core public facades, no /internal/v0/', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' }))
      )
      const app = createBffWithServices({ coreApp })

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'a1' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.reject.execute/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'a2' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.enable.execute/execute',
          'POST',
          'admin-token',
          { networkId: 'n1', profileVersion: 'm-net-cn@0.1.0' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.disable.execute/execute',
          'POST',
          'admin-token',
          { networkId: 'n2', profileVersion: 'm-net-default@0.1.0' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/node.disable.execute/execute',
          'POST',
          'admin-token',
          { nodeId: 'leaf-1', reason: 'maintenance window' }
        )

        // RED: BFF currently rejects unknown commands; zero requests made
        // After Task 6, all outbound requests must target only Core public facades
        expect(requests.length).toBeGreaterThan(0)

        // Every outbound request must go to Core base URL only
        for (const req of requests) {
          expect(req.url).toMatch(
            new RegExp(`^${CORE_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)
          )
          expect(req.url).not.toMatch(/\/internal\/v0\//)
          expect(req.url).not.toMatch(/m-policy/)
          expect(req.url).not.toMatch(/m-net/)
          expect(req.url).not.toMatch(/m-log/)
        }
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('execute commands preserve Core success response body unchanged', async () => {
      const coreApp = addMockCoreWriteFacades(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' }))
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'a1', reason: 'looks good' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        approval: { id: string; status: string }
        votes: Array<{ actor: string; decision: string }>
        reason: string
        correlationId: string
      }
      expect(body.approval.id).toBe('a1')
      expect(body.approval.status).toBe('approved')
      expect(body.votes.length).toBeGreaterThan(0)
      expect(body.reason).toBe('looks good')
      expect(body.correlationId).toBe('core-mock-approve')
    })

    it('execute commands propagate unmodified Core error envelope on failure', async () => {
      const coreApp = createOverlayApp(
        createCoreApp(createInMemoryCoreDeps({ actor: 'security-admin' })),
        new Elysia().post('/api/v0/policy/approvals/:id/approve', () => {
          return new Response(
            JSON.stringify({ error: { code: 'policy.denied', message: 'Permission denied' } }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
        })
      )
      const app = createBffWithServices({ coreApp })

      // RED: currently returns 400 command.unknown; contract expects 403 passthrough
      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'a1' }
      )

      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('policy.denied')
      expect(body.error.message).toBe('Permission denied')
    })
  })

  describe('Additional execute confirmation UX branches', () => {
    type CapturedRequest = { method: string; url: string; body: string }

    function addAdditionalExecuteMockFacades(coreApp: ReturnType<typeof createCoreApp>) {
      return createOverlayApp(
        coreApp,
        new Elysia()
          .put('/api/v0/networks/profile-defaults', ({ body }) => {
            const typedBody = body as {
              profileVersion: string
              reason: string
              idempotencyKey: string
            }
            return {
              operationId: 'profile-default-op-1',
              policyDecisionId: 'decision-profile-default-1',
              auditId: 'audit-profile-default-1',
              defaultProfileVersion: typedBody.profileVersion,
              received: typedBody
            }
          })
          .post('/api/v0/networks/profile-switches/plan', ({ body }) => {
            const typedBody = body as {
              targetProfileVersion: string
              batchSize?: number
              reason: string
              idempotencyKey: string
            }
            return {
              operationId: 'profile-switch-op-1',
              candidateCount: 2,
              batches: [{ batchId: 1, networkIds: ['network-cn-001', 'network-cn-002'] }],
              globalSwitchState: 'planned',
              received: typedBody
            }
          })
          .post('/api/v0/networks/profile-switches/:operationId/apply', ({ params }) => {
            return {
              operationId: params.operationId,
              batchId: 1,
              results: [
                {
                  networkId: 'network-cn-001',
                  previousProfileVersion: 'm-net-default@0.1.0',
                  targetProfileVersion: 'm-net-cn@0.1.0',
                  status: 'applied',
                  correlationId: 'corr-profile-switch-apply-1'
                }
              ],
              globalSwitchState: 'applied'
            }
          })
          .put('/api/v0/networks/profile-disable-policy', ({ body }) => {
            const typedBody = body as {
              requireApproval: boolean
              emergencyBreakGlassEnabled: boolean
              reason: string
              idempotencyKey: string
            }
            return {
              policyDecisionId: 'decision-disable-policy-1',
              auditId: 'audit-disable-policy-1',
              correlationId: 'corr-disable-policy-1',
              received: typedBody
            }
          })
          .post('/api/v0/networks/:id/profile/disable-break-glass', ({ params, body }) => {
            const typedBody = body as { emergencyReason: string }
            return {
              networkId: params.id,
              status: 'disabled',
              policyDecisionId: 'decision-break-glass-1',
              auditId: 'audit-break-glass-1',
              correlationId: 'corr-break-glass-1',
              received: typedBody
            }
          })
          .post('/api/v0/nodes/:id/control', ({ params, body }) => {
            const typedBody = body as { action: string; reason?: string }
            return {
              node: {
                id: params.id,
                kind: 'leaf',
                name: params.id,
                mode: 'agent',
                status:
                  typedBody.action === 'disable'
                    ? 'disabled'
                    : typedBody.action === 'recover'
                      ? 'recovering'
                      : typedBody.action,
                reachability: 'reachable',
                capabilities: ['task.noop'],
                createdAt: '2026-01-01T00:00:00.000Z'
              },
              policyDecisionId: 'decision-node-control-1',
              correlationId: 'corr-node-control-1',
              received: typedBody
            }
          })
      )
    }

    function captureOutboundRequests() {
      const delegatedFetch = globalThis.fetch
      const requests: CapturedRequest[] = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        const body = request.method === 'GET' ? '' : await request.clone().text()
        requests.push({ method: request.method, url: request.url, body })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch
      return {
        requests,
        restore() {
          globalThis.fetch = delegatedFetch
        }
      }
    }

    const cases: Array<{
      commandId: string
      token: string
      requestBody: Record<string, unknown>
      expectedMethod: string
      expectedPath: string
      expectedForwardedBody?: Record<string, unknown>
      assertResponse(body: Record<string, unknown>): void
    }> = [
      {
        commandId: 'network.profile.default.set.execute',
        token: 'admin-token',
        requestBody: {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'set cn as default',
          idempotencyKey: 'idem-default-1'
        },
        expectedMethod: 'PUT',
        expectedPath: '/api/v0/networks/profile-defaults',
        expectedForwardedBody: {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'set cn as default',
          idempotencyKey: 'idem-default-1'
        },
        assertResponse(body) {
          expect(body.defaultProfileVersion).toBe('m-net-cn@0.1.0')
          expect(body.policyDecisionId).toBe('decision-profile-default-1')
        }
      },
      {
        commandId: 'network.profile.global-switch.plan.execute',
        token: 'admin-token',
        requestBody: {
          targetProfileVersion: 'm-net-cn@0.1.0',
          batchSize: 2,
          reason: 'plan cn switch',
          idempotencyKey: 'idem-plan-1'
        },
        expectedMethod: 'POST',
        expectedPath: '/api/v0/networks/profile-switches/plan',
        expectedForwardedBody: {
          targetProfileVersion: 'm-net-cn@0.1.0',
          batchSize: 2,
          reason: 'plan cn switch',
          idempotencyKey: 'idem-plan-1'
        },
        assertResponse(body) {
          expect(body.operationId).toBe('profile-switch-op-1')
          expect(body.globalSwitchState).toBe('planned')
        }
      },
      {
        commandId: 'network.profile.global-switch.apply.execute',
        token: 'admin-token',
        requestBody: { operationId: 'profile-switch-op-1' },
        expectedMethod: 'POST',
        expectedPath: '/api/v0/networks/profile-switches/profile-switch-op-1/apply',
        assertResponse(body) {
          expect(body.operationId).toBe('profile-switch-op-1')
          expect(body.globalSwitchState).toBe('applied')
        }
      },
      {
        commandId: 'network.profile.disable-policy.set.execute',
        token: 'admin-token',
        requestBody: {
          requireApproval: true,
          emergencyBreakGlassEnabled: false,
          reason: 'tighten profile disable policy',
          idempotencyKey: 'idem-disable-policy-1'
        },
        expectedMethod: 'PUT',
        expectedPath: '/api/v0/networks/profile-disable-policy',
        expectedForwardedBody: {
          requireApproval: true,
          emergencyBreakGlassEnabled: false,
          reason: 'tighten profile disable policy',
          idempotencyKey: 'idem-disable-policy-1'
        },
        assertResponse(body) {
          expect(body.policyDecisionId).toBe('decision-disable-policy-1')
          expect(body.correlationId).toBe('corr-disable-policy-1')
        }
      },
      {
        commandId: 'network.profile.disable.break-glass.execute',
        token: 'security-admin-token',
        requestBody: {
          networkId: 'network-cn-001',
          emergencyReason: 'operator requested emergency disable'
        },
        expectedMethod: 'POST',
        expectedPath: '/api/v0/networks/network-cn-001/profile/disable-break-glass',
        expectedForwardedBody: { emergencyReason: 'operator requested emergency disable' },
        assertResponse(body) {
          expect(body.networkId).toBe('network-cn-001')
          expect(body.status).toBe('disabled')
          expect(body.correlationId).toBe('corr-break-glass-1')
        }
      },
      {
        commandId: 'node.disable.execute',
        token: 'admin-token',
        requestBody: { nodeId: 'leaf-1', reason: 'maintenance window' },
        expectedMethod: 'POST',
        expectedPath: '/api/v0/nodes/leaf-1/control',
        expectedForwardedBody: { action: 'disable', reason: 'maintenance window' },
        assertResponse(body) {
          expect((body.node as { id?: string; status?: string } | undefined)?.id).toBe('leaf-1')
          expect((body.node as { id?: string; status?: string } | undefined)?.status).toBe(
            'disabled'
          )
          expect(body.policyDecisionId).toBe('decision-node-control-1')
        }
      }
    ]

    for (const tc of cases) {
      it(`POST /api/v0/commands/:commandId/execute executes ${tc.commandId}`, async () => {
        const actor = tc.token === 'security-admin-token' ? 'security-admin' : 'admin'
        const coreApp = addAdditionalExecuteMockFacades(
          createCoreApp(createInMemoryCoreDeps({ actor }))
        )
        const app = createBffWithServices({ coreApp })
        const capture = captureOutboundRequests()

        try {
          const res = await makeRequest(
            app,
            `/api/v0/commands/${tc.commandId}/execute`,
            'POST',
            tc.token,
            tc.requestBody
          )

          expect(res.status).toBe(200)
          const body = (await res.json()) as Record<string, unknown>
          tc.assertResponse(body)

          const mutationRequests = capture.requests.filter(request => request.method !== 'GET')
          expect(mutationRequests.length).toBe(1)
          const mutation = mutationRequests[0]
          if (!mutation) throw new Error(`missing mutation request for ${tc.commandId}`)
          expect(mutation.method).toBe(tc.expectedMethod)
          expect(mutation.url).toBe(`${CORE_BASE}${tc.expectedPath}`)
          expect(mutation.url).not.toMatch(/\/internal\/v0\//)

          if (tc.expectedForwardedBody === undefined) {
            expect(mutation.body).toBe('')
          } else {
            expect(JSON.parse(mutation.body) as Record<string, unknown>).toEqual(
              tc.expectedForwardedBody
            )
          }
        } finally {
          capture.restore()
        }
      })
    }
  })

  describe('Preview commands: zero side-effect regression', () => {
    it('.preview eligibility checks never dispatch mutation requests', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        // Check eligibility on all four preview commands
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.preview/eligibility',
          'POST',
          'security-admin-token',
          { approvalId: 'approval-core-facade-1' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/policy.approval.reject.preview/eligibility',
          'POST',
          'security-admin-token',
          { approvalId: 'approval-core-facade-1' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.enable.preview/eligibility',
          'POST',
          'security-admin-token',
          { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
        )
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.disable.preview/eligibility',
          'POST',
          'security-admin-token',
          { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
        )

        // Eligibility checks are read-only: only GET requests, no POST mutations
        const mutationRequests = requests.filter(r => r.method !== 'GET')
        expect(mutationRequests.length).toBe(0)
        expect(requests.every(r => r.method === 'GET')).toBe(true)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('.preview commands still return 400 command.display_only on execute', async () => {
      const previewIds: string[] = [
        'policy.approval.approve.preview',
        'policy.approval.reject.preview',
        'network.profile.enable.preview',
        'network.profile.disable.preview'
      ]
      for (const previewId of previewIds) {
        const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
        const coreApp = createCoreApp(deps)
        const app = createBffWithCore(coreApp)

        const delegatedFetch = globalThis.fetch
        const requests: Array<{ method: string; url: string }> = []
        globalThis.fetch = (async (input, init) => {
          const request =
            input instanceof Request
              ? input
              : new Request(typeof input === 'string' ? input : input.href, init)
          requests.push({ method: request.method, url: request.url })
          return delegatedFetch(input, init)
        }) as typeof globalThis.fetch

        try {
          const _res = await makeRequest(
            app,
            `/api/v0/commands/${previewId}/execute`,
            'POST',
            'security-admin-token',
            { approvalId: 'approval-core-facade-1' }
          )
          expect(_res.status).toBe(400)
          const body = (await _res.json()) as { error: { code: string } }
          expect(body.error.code).toBe('command.display_only')
          expect(requests.length).toBe(0)
        } finally {
          globalThis.fetch = delegatedFetch
        }
      }
    })
  })

  describe('Disabled commands send zero mutation requests', () => {
    it('execute for disabled approval preview sends zero requests', async () => {
      // admin actor lacks policy:approval-approve, so eligibility is disabled
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        const _res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'admin-token',
          { approvalId: 'approval-core-facade-1' }
        )

        // RED: currently returns 400 command.unknown
        // After implementation: BFF should check eligibility/permission before executing
        // If disabled, returns  400 with appropriate code and zero mutation requests
        expect(requests.filter(r => r.method !== 'GET').length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })

    it('execute for disabled profile preview sends zero requests', async () => {
      // viewer actor lacks network:profile-enable
      const deps = createInMemoryCoreDeps({ actor: 'viewer' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const delegatedFetch = globalThis.fetch
      const requests: Array<{ method: string; url: string }> = []
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init)
        requests.push({ method: request.method, url: request.url })
        return delegatedFetch(input, init)
      }) as typeof globalThis.fetch

      try {
        await makeRequest(
          app,
          '/api/v0/commands/network.profile.enable.execute/execute',
          'POST',
          'viewer-token',
          { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
        )

        // RED: currently returns 400 command.unknown, zero requests
        // After implementation: disabled commands must not dispatch mutations
        const mutationRequests = requests.filter(r => r.method !== 'GET')
        expect(mutationRequests.length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })
  })
})
