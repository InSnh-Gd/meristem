import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createOverlayApp } from './_helpers/http-overlay.ts'
import {
  CORE_BASE,
  createBffWithServices,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerCommandWellCoreDispatchContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
  })
}
