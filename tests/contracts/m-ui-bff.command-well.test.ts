import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import {
  CommandWellEligibilitySchema,
  OperationalCommandPreviewSchema
} from '../../packages/contracts/src/index.ts'
import {
  captureOriginalFetch,
  createBffWithCore,
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
})
