import { describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { OperationalCommandPreviewSchema } from '../../packages/contracts/src/index.ts'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerCommandWellPreviewEligibilityContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
      expect(
        Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))
      ).toBe(true)
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
      expect(
        Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))
      ).toBe(true)
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
      expect(
        Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))
      ).toBe(true)
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
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.3.0' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        commandId: string
        state: string
        disabledReason?: string
        displayOnly: boolean
      }
      expect(
        Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))
      ).toBe(true)
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
        { networkId: 'network-default-001', profileVersion: 'm-net@0.3.0' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        commandId: string
        state: string
        disabledReason?: string
        displayOnly: boolean
      }
      expect(
        Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))
      ).toBe(true)
      expect(body.commandId).toBe('network.profile.disable.preview')
      expect(body.state).toBe('disabled')
      expect(body.disabledReason).toBe('Profile 操作当前仅提供只读预览')
      expect(body.displayOnly).toBe(true)
    })

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

    it('POST /api/v0/commands/:commandId/eligibility returns disabled preview for network.profile.enable.preview with insufficient permissions', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'viewer' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.preview/eligibility',
        'POST',
        'viewer-token',
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.3.0' }
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
  })
}
