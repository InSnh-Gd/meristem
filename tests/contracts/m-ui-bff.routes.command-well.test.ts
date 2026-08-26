import { describe, expect, it } from 'bun:test'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import {
  CORE_BASE,
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  createInMemoryMTaskDeps,
  createMTaskApp,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerRoutesCommandWellContractTests(): void {
  describe('SDUI v0.2 BFF routes', () => {
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
          body: JSON.stringify({
            kind: 'leaf',
            name: 'sdui-v02-eligibility-leaf',
            mode: 'simulated'
          })
        })
      )
      const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

      const app = createBffWithCore(coreApp)
      const res = await makeRequest(
        app,
        '/api/v0/commands/task.noop.submit/eligibility',
        'POST',
        'operator-token',
        { leafNodeId: leafId }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { command: { id: string }; state: string }
      expect(body.command.id).toBe('task.noop.submit')
      expect(body.state).toBe('enabled')
    })

    it('POST /api/v0/commands/:commandId/eligibility rejects unknown command', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/unknown.cmd/eligibility',
        'POST',
        'operator-token',
        { leafNodeId: 'leaf-placeholder' }
      )
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
          body: JSON.stringify({ kind: 'leaf', name: 'sdui-v02-execute-leaf', mode: 'simulated' })
        })
      )
      const leafId = ((await regRes.json()) as { node: { id: string } }).node.id

      const app = createBffWithCore(coreApp, taskApp)
      const res = await makeRequest(
        app,
        '/api/v0/commands/task.noop.submit/execute',
        'POST',
        'operator-token',
        { leafNodeId: leafId }
      )
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

    it('POST /api/v0/commands/:commandId/execute rejects unknown command', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'operator' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/unknown.cmd/execute',
        'POST',
        'operator-token',
        { leafNodeId: 'leaf-placeholder' }
      )
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/commands/:commandId/eligibility supports approval preview command ids', async () => {
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
      const body = (await res.json()) as { commandId: string; displayOnly: boolean }
      expect(body.commandId).toBe('policy.approval.approve.preview')
      expect(body.displayOnly).toBe(true)
    })

    it('POST /api/v0/commands/:commandId/execute rejects display-only preview command ids', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.preview/execute',
        'POST',
        'admin-token',
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.3.0' }
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('command.display_only')
    })

    it('request permissions are not cached between different tokens in one BFF app', async () => {
      const app = createBffWithCore(createCoreApp(createInMemoryCoreDeps({ actor: 'admin' })))

      const adminApproval = await makeRequest(app, '/api/v0/policy/approvals', 'GET', 'admin-token')
      expect(adminApproval.status).toBe(200)

      const operatorApproval = await makeRequest(
        app,
        '/api/v0/policy/approvals',
        'GET',
        'operator-token'
      )
      expect(operatorApproval.status).toBe(403)
      expect(await operatorApproval.json()).toMatchObject({ error: { code: 'policy.denied' } })

      const adminProfiles = await makeRequest(app, '/api/v0/network-profiles', 'GET', 'admin-token')
      expect(adminProfiles.status).toBe(200)

      const viewerProfiles = await makeRequest(
        app,
        '/api/v0/network-profiles',
        'GET',
        'viewer-token'
      )
      expect(viewerProfiles.status).toBe(403)
      expect(await viewerProfiles.json()).toMatchObject({ error: { code: 'policy.denied' } })
    })
  })
}

describe('SDUI v0.2 BFF OpenAPI', () => {
  it('OpenAPI exposes only UI-facing BFF routes', async () => {
    const app = createMUiBffApp({ coreBaseUrl: CORE_BASE })

    const res = await makeRequest(app, '/openapi')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('/api/v0')
  })
})
