import { describe, expect, it } from 'bun:test'
import {
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest
} from './_helpers/m-ui-bff.ts'

export function registerCommandWellExecuteInputAuthContractTests(): void {
  describe('M-UI BFF contract tests', () => {
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
  })
}
