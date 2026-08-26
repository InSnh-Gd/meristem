import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerCommandWellPreviewExecuteContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.3.0' }
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
        { networkId: 'network-cn-001', profileVersion: 'm-net@0.3.0' }
      )
      const audit = await deps.log.listAudit()

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('command.display_only')
      expect(requests.length).toBe(0)
      expect(audit.ok ? audit.value.length : -1).toBe(0)
    })

    // =============================================================================
    // Execute commands (RED: must fail before Tasks 5-6 implementation)
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
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.3.0' }
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
        { networkId: 'network-cn-001', profileVersion: 'm-net@0.3.0' }
      )

      // profile disable 透传 Core facade 的 disabled 结果。
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: string
        profileVersion: string
        correlationId: string
      }
      expect(body.status).toBe('disabled')
      expect(body.profileVersion).toBe('m-net@0.3.0')
      expect(body.correlationId).toBeDefined()
      expect(requests.length).toBeGreaterThan(0)
    })

    // =============================================================================
    // Random / unsupported command id (RED: not yet implemented)
    // =============================================================================

    it('POST /api/v0/commands/:commandId/execute rejects random.unknown.command as unknown (RED)', async () => {
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
  })
}
