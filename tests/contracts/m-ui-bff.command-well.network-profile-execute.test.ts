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

export function registerCommandWellNetworkProfileExecuteContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
  })
}
