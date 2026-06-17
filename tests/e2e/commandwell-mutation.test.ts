/**
 * E2E-style CommandWell Mutation Contract Tests (TDD Red Phase)
 *
 * Tests the UX contract for CommandWell mutation execution from the BFF boundary.
 * Uses app.handle() pattern (no external infra required).
 *
 * Contract:
 * - Confirmation before every mutation request
 * - Inline success evidence with correlationId + policyDecisionId
 * - Inline Core/BFF error envelope on failure (no toast/snackbar)
 * - Post-success refresh of detail screen and relevant regions
 * - Disabled command state sends zero mutation requests
 *
 * STATUS: TDD RED — all mutation execute flows should fail with 400 command.unknown
 * until Tasks 5-6 implement Core facades and BFF execute mappings.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { OperationalCommandPreviewSchema } from '../../packages/contracts/src/index.ts'
import {
  captureOriginalFetch,
  createBffWithCore,
  createCoreApp,
  createInMemoryCoreDeps,
  makeRequest,
  restoreOriginalFetch
} from '../contracts/_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

describe('E2E: CommandWell Mutation UX Contract', () => {
  describe('approval execute confirmation UX', () => {
    it('approval approve execute returns success evidence with correlationId (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'approval-core-facade-1' }
      )

      // RED: currently returns 400 command.unknown
      // After implementation: 200 with approval data + correlationId
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toHaveProperty('approval')
      expect(body).toHaveProperty('correlationId')
    })

    it('approval reject execute returns success evidence (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.reject.execute/execute',
        'POST',
        'security-admin-token',
        { approvalId: 'approval-core-facade-1' }
      )

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toHaveProperty('approval')
      expect(body).toHaveProperty('correlationId')
    })

    it('approval execute without token returns 401 (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        undefined,
        { approvalId: 'approval-core-facade-1' }
      )

      // BFF should check auth before forwarding to Core
      expect(res.status).toBe(401)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })

    it('approval execute when disabled sends zero upstream requests (RED)', async () => {
      // viewer actor lacks policy:approval-approve → command should be disabled
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
        const _res = await makeRequest(
          app,
          '/api/v0/commands/policy.approval.approve.execute/execute',
          'POST',
          'viewer-token',
          { approvalId: 'approval-core-facade-1' }
        )

        // Disabled command must send ZERO mutation requests
        expect(requests.filter(r => r.method !== 'GET').length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })
  })

  describe('profile execute confirmation UX', () => {
    it('profile enable execute returns success evidence (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.execute/execute',
        'POST',
        'admin-token',
        { networkId: 'network-cn-001', profileVersion: 'm-net-cn@0.1.0' }
      )

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toHaveProperty('correlationId')
    })

    it('profile disable execute returns success evidence (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.disable.execute/execute',
        'POST',
        'admin-token',
        { networkId: 'network-cn-001', profileVersion: 'm-net-default@0.1.0' }
      )

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toHaveProperty('correlationId')
    })

    it('profile execute without selected network returns error (RED)', async () => {
      const deps = createInMemoryCoreDeps({ actor: 'admin' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      // Missing networkId should fail body validation
      const res = await makeRequest(
        app,
        '/api/v0/commands/network.profile.enable.execute/execute',
        'POST',
        'admin-token',
        { profileVersion: 'm-net-cn@0.1.0' } // missing networkId
      )

      // Should fail body validation — currently returns command.unknown
      expect(res.status).toBe(400)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toMatch(/invalid_body|VALIDATION/)
      expect(res.status).not.toBe(200)
    })
  })

  describe('error passthrough UX', () => {
    it('Core 403 passthrough renders inline error (RED)', async () => {
      // When Core denies with 403, BFF must preserve the error inline
      const deps = createInMemoryCoreDeps({ actor: 'viewer' })
      const coreApp = createCoreApp(deps)
      const app = createBffWithCore(coreApp)

      const res = await makeRequest(
        app,
        '/api/v0/commands/policy.approval.approve.execute/execute',
        'POST',
        'viewer-token', // lacks policy:approval-approve
        { approvalId: 'approval-core-facade-1' }
      )

      // Should return permission error inline, not as toast
      // Currently returns 400 command.unknown (RED)
      const body = await res.json() as { error?: { code: string } }
      // Error must be inline (in response body), not a separate toast mechanism
      expect(body).toHaveProperty('error')
    })

    it('command body must not contain toast/snackbar metadata', () => {
      // Static assertion: the error response schema must not include
      // toast/snackbar metadata fields
      const previewSchema = JSON.stringify(OperationalCommandPreviewSchema.ast ?? {})
      expect(previewSchema).not.toContain('toast')
      expect(previewSchema).not.toContain('snackbar')
    })
  })

  describe('confirmation flow contract', () => {
    it('preview commands remain displayOnly with Chinese labels', async () => {
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
      const body = await res.json() as Record<string, unknown>
      expect(Either.isRight(Schema.decodeUnknownEither(OperationalCommandPreviewSchema)(body))).toBe(true)
      expect(body.commandId).toBe('policy.approval.approve.preview')
      expect(body.displayOnly).toBe(true)
      // Chinese label must exist in command definition
      expect(body.label).toBe('批准审批请求')
    })

    it('preview commands cannot be executed (confirmation gate)', async () => {
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
          '/api/v0/commands/policy.approval.reject.preview/execute',
          'POST',
          'security-admin-token',
          { approvalId: 'approval-core-facade-1' }
        )

        expect(res.status).toBe(400)
        const body = await res.json() as { error: { code: string } }
        expect(body.error.code).toBe('command.display_only')
        // Confirmation gate: zero mutation requests for preview commands
        expect(requests.length).toBe(0)
      } finally {
        globalThis.fetch = delegatedFetch
      }
    })
  })
})
