import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerCommandWellSideEffectsContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
}
