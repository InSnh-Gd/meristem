import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  infrastructureAvailable,
  startFullStack,
  stopFullStack,
  coreFetch,
  taskFetch
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: Core REST', () => {
    it('skipped: PostgreSQL or NATS is not available (run docker compose up -d postgres nats)', () => {
      expect(true).toBe(true)
    })
  })
} else {
  let devAll: ManagedProcess
  let bffProcess: ManagedProcess
  let operatorToken = ''
  let viewerToken = ''
  let securityAdminToken = ''

  describe('e2e: Core REST', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      devAll = stack.devAll
      bffProcess = stack.bffProcess
      operatorToken = stack.operatorToken
      viewerToken = stack.viewerToken
      securityAdminToken = stack.securityAdminToken
    }, 60_000)

    afterAll(async () => {
      await stopFullStack(devAll, bffProcess)
    }, 30_000)

    describe('public endpoints', () => {
      it('health returns ok', async () => {
        const res = await coreFetch('/api/v0/health')
        expect(res.ok).toBe(true)
        expect(res.status).toBe(200)
        const body = res.data as { ok: boolean; service: string }
        expect(body.ok).toBe(true)
        expect(body.service).toBe('meristem-core')
      })

      it('ready returns ready state', async () => {
        const res = await coreFetch('/api/v0/ready')
        expect(res.ok).toBe(true)
        expect(res.status).toBe(200)
        const body = res.data as { ready: boolean; dependencies: Record<string, unknown> }
        expect(typeof body.ready).toBe('boolean')
        expect(typeof body.dependencies).toBe('object')
      })
    })

    describe('auth & session', () => {
      it('session returns operator permissions', async () => {
        const res = await coreFetch('/api/v0/session', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { actor: string; permissions: string[] }
        expect(body.actor).toBe('operator')
        expect(body.permissions).toContain('task:submit')
        expect(body.permissions).not.toContain('audit:read')
      })

      it('session returns viewer permissions without audit:read', async () => {
        const res = await coreFetch('/api/v0/session', viewerToken)
        expect(res.ok).toBe(true)
        const body = res.data as { actor: string; permissions: string[] }
        expect(body.actor).toBe('viewer')
        expect(body.permissions).not.toContain('audit:read')
      })

      it('missing token returns 401', async () => {
        const res = await coreFetch('/api/v0/status')
        expect(res.status).toBe(401)
      })

      it('invalid token returns 401', async () => {
        const res = await coreFetch('/api/v0/status', 'bad-token')
        expect(res.status).toBe(401)
      })

      it('viewer can read status with core:read', async () => {
        const res = await coreFetch('/api/v0/status', viewerToken)
        expect(res.status).toBe(200)
      })
    })

    describe('status', () => {
      it('operator reads status shape', async () => {
        const res = await coreFetch('/api/v0/status', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as {
          core: { id: string; version: string; mode: string }
          dependencies: Record<string, unknown>
          counts: { services: number; nodes: number; tasks: number }
        }
        expect(body.core.id).toBe('meristem-core')
        expect(body.core.mode).toBe('normal')
        expect(typeof body.counts.services).toBe('number')
        expect(typeof body.counts.nodes).toBe('number')
        expect(typeof body.counts.tasks).toBe('number')
      })
    })

    describe('nodes', () => {
      it('registers a simulated stem node', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'stem', name: 'e2e-stem', mode: 'simulated' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string; kind: string; name: string; mode: string; status: string } }
        expect(body.node.kind).toBe('stem')
        expect(body.node.name).toBe('e2e-stem')
        expect(body.node.mode).toBe('simulated')
        expect(body.node.status).toBe('healthy')
      })

      it('registers a simulated leaf node', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-leaf', mode: 'simulated' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string; kind: string; name: string; mode: string } }
        expect(body.node.kind).toBe('leaf')
        expect(body.node.name).toBe('e2e-leaf')
        expect(body.node.mode).toBe('simulated')
      })

      it('lists nodes including registered ones', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { nodes: Array<{ name: string }> }
        const names = body.nodes.map((n) => n.name)
        expect(names).toContain('e2e-stem')
        expect(names).toContain('e2e-leaf')
      })

      it('viewer cannot register node (403)', async () => {
        const res = await coreFetch('/api/v0/nodes', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'viewer-leaf' })
        })
        expect(res.status).toBe(403)
      })

      it('agent mode registration returns 409', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-agent-leaf', mode: 'agent' })
        })
        expect(res.status).toBe(409)
      })

      it('creates a join ticket for a leaf node', async () => {
        const res = await coreFetch('/api/v0/node-tickets', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-ticket-leaf' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { ticketId: string; ticket: string; joinUrl: string; policyDecisionId: string }
        expect(typeof body.ticketId).toBe('string')
        expect(typeof body.ticket).toBe('string')
        expect(body.joinUrl).toContain('8443')
        expect(typeof body.policyDecisionId).toBe('string')
      })

      it('issues node credential', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await coreFetch(`/api/v0/nodes/${leaf!.id}/credentials`, operatorToken, { method: 'POST' })
        expect(res.ok).toBe(true)
        const body = res.data as { nodeId: string; token: string; policyDecisionId: string }
        expect(body.nodeId).toBe(leaf!.id)
        expect(typeof body.token).toBe('string')
      })

      it('viewer cannot issue node token (403)', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await coreFetch(`/api/v0/nodes/${nodes[0].id}/credentials`, viewerToken, { method: 'POST' })
        expect(res.status).toBe(403)
      })
    })

    describe('tasks', () => {
      it('does not expose canonical task submission through Core', async () => {
        const res = await coreFetch('/api/v0/tasks', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ nodeId: 'node-e2e-missing', type: 'noop' })
        })
        expect(res.status).toBe(404)
      })

      it('submits noop task through M-Task', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await taskFetch('/api/v0/tasks', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ nodeId: leaf!.id, type: 'noop' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { task: { id: string; status: string; nodeId: string; type: string }; policyDecisionId: string }
        expect(body.task.status).toBe('completed')
        expect(body.task.nodeId).toBe(leaf!.id)
        expect(body.task.type).toBe('noop')
      })

      it('viewer cannot submit task through M-Task (403)', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await taskFetch('/api/v0/tasks', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ nodeId: nodes[0].id, type: 'noop' })
        })
        expect(res.status).toBe(403)
      })
    })

    describe('networks', () => {
      it('creates a logical network', async () => {
        const res = await coreFetch('/api/v0/networks', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ name: `e2e-net-${Date.now()}` })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { network: { id: string; name: string }; policyDecisionId: string }
        expect(body.network.name).toStartWith('e2e-net-')
        expect(typeof body.network.id).toBe('string')
      })

      it('lists networks', async () => {
        const res = await coreFetch('/api/v0/networks', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { networks: Array<{ name: string }> }
        expect(body.networks.some((n) => n.name.startsWith('e2e-net-'))).toBe(true)
      })

      it('joins a stem node to the network', async () => {
        const netRes = await coreFetch('/api/v0/networks', operatorToken)
        const nets = (netRes.data as { networks: Array<{ id: string; name: string }> }).networks
        const net = nets.find((n) => n.name.startsWith('e2e-net-'))
        expect(net).toBeDefined()

        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const stem = nodes.find((n) => n.name === 'e2e-stem')
        expect(stem).toBeDefined()

        const res = await coreFetch(`/api/v0/networks/${net!.id}/members`, operatorToken, {
          method: 'POST',
          body: JSON.stringify({ nodeId: stem!.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { member: { networkId: string; nodeId: string } }
        expect(body.member.networkId).toBe(net!.id)
        expect(body.member.nodeId).toBe(stem!.id)
      })

      it('viewer cannot create network (403)', async () => {
        const res = await coreFetch('/api/v0/networks', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ name: 'viewer-net' })
        })
        expect(res.status).toBe(403)
      })
    })

    describe('services', () => {
      it('lists services', async () => {
        const res = await coreFetch('/api/v0/services', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { services: Array<{ id: string; status: string }> }
        expect(Array.isArray(body.services)).toBe(true)
      })

      it('reloads a service', async () => {
        const res = await coreFetch('/api/v0/services/m-log/reload', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ reason: 'e2e smoke' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { serviceId: string; accepted: boolean }
        expect(body.serviceId).toBe('m-log')
        expect(body.accepted).toBe(true)
      })

      it('viewer cannot reload service (403)', async () => {
        const res = await coreFetch('/api/v0/services/m-log/reload', viewerToken, {
          method: 'POST',
          body: JSON.stringify({})
        })
        expect(res.status).toBe(403)
      })
    })

    describe('logs', () => {
      it('operator reads timeline', async () => {
        const res = await coreFetch('/api/v0/logs/timeline', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ summary: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('operator reads full logs', async () => {
        const res = await coreFetch('/api/v0/logs/full', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ level: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('security-admin reads audit logs', async () => {
        const res = await coreFetch('/api/v0/audit', securityAdminToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ actor: string; action: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
        expect(body.entries.length).toBeGreaterThan(0)
      })

      it('operator cannot read audit (403)', async () => {
        const res = await coreFetch('/api/v0/audit', operatorToken)
        expect(res.status).toBe(403)
      })

      it('viewer cannot read full logs (403)', async () => {
        const res = await coreFetch('/api/v0/logs/full', viewerToken)
        expect(res.status).toBe(403)
      })
    })

    describe('policy', () => {
      it('reads a policy decision by id', async () => {
        const register = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: `policy-leaf-${Date.now()}`, mode: 'simulated' })
        })
        const registered = register.data as { policyDecisionId: string }
        const res = await coreFetch(`/api/v0/policy/decisions/${registered.policyDecisionId}`, operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { decision: { id: string; actor: string; result: string } }
        expect(body.decision.id).toBe(registered.policyDecisionId)
        expect(body.decision.actor).toBe('operator')
      })
    })

    describe('identity v0.2', () => {
      it('security-admin lists actors', async () => {
        // FAILS RED: identity routes not mounted in Core app yet → 404
        const res = await coreFetch('/api/v0/identity/actors', securityAdminToken)
        expect(res.status).toBe(200)
        const body = res.data as { actors: Array<{ id: string; displayName: string; status: string }> }
        expect(Array.isArray(body.actors)).toBe(true)
        expect(body.actors.length).toBeGreaterThan(0)
        expect(body.actors.some((a) => a.id === 'operator')).toBe(true)
      })

      it('operator cannot list actors (identity:read self only, not all)', async () => {
        const res = await coreFetch('/api/v0/identity/actors', operatorToken)
        // FAILS RED: identity routes not mounted → 404
        expect(res.status).toBe(403)
      })

      it('security-admin issues a token for operator', async () => {
        // FAILS RED: identity routes not mounted → 404
        const res = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            actor: 'operator',
            ttl: '1h',
            purpose: 'E2E-IDY-ISSUE smoke test'
          })
        })
        expect(res.status).toBe(201)
        const body = res.data as {
          token: string
          jti: string
          actor: string
          issuer: string
          audience: string
          purpose: string
          status: string
        }
        expect(typeof body.token).toBe('string')
        expect(typeof body.jti).toBe('string')
        expect(body.actor).toBe('operator')
        expect(body.issuer).toBe('meristem-local')
        expect(body.audience).toBe('meristem-core')
        expect(body.purpose).toBe('E2E-IDY-ISSUE smoke test')
        expect(body.status).toBe('active')
        // Token must be a JWT with 3 dot-separated parts
        expect(body.token.split('.').length).toBe(3)
      })

      it('operator cannot issue tokens (lacks identity:token-issue)', async () => {
        const res = await coreFetch('/api/v0/identity/tokens', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            actor: 'viewer',
            ttl: '1h',
            purpose: 'E2E-IDY-ISSUE unauthorized'
          })
        })
        // FAILS RED: identity routes not mounted → 404
        // Once wired: operator lacks identity:token-issue → 403
        expect(res.status).toBe(403)
      })

      it('viewer cannot issue tokens', async () => {
        const res = await coreFetch('/api/v0/identity/tokens', viewerToken, {
          method: 'POST',
          body: JSON.stringify({
            actor: 'operator',
            ttl: '1h',
            purpose: 'E2E-IDY-ISSUE viewer attempt'
          })
        })
        // FAILS RED: identity routes not mounted → 404
        expect(res.status).toBe(403)
      })

      it('security-admin issues → inspects → revokes token lifecycle', async () => {
        // ── Issue ──
        const issueRes = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            actor: 'operator',
            ttl: '1h',
            purpose: 'E2E-IDY-LIFECYCLE full test'
          })
        })
        // FAILS RED: identity routes not mounted → 404
        expect(issueRes.status).toBe(201)
        const issueBody = issueRes.data as { token: string; jti: string; status: string }

        expect(issueBody.status).toBe('active')
        const issuedJti = issueBody.jti
        const issuedToken = issueBody.token

        // ── Inspect ──
        const inspectRes = await coreFetch(
          `/api/v0/identity/tokens/${issuedJti}`,
          securityAdminToken
        )
        expect(inspectRes.status).toBe(200)
        const inspectBody = inspectRes.data as {
          jti: string
          actor: string
          purpose: string
          status: string
        }
        expect(inspectBody.jti).toBe(issuedJti)
        expect(inspectBody.actor).toBe('operator')
        expect(inspectBody.status).toBe('active')
        expect(inspectBody.purpose).toBe('E2E-IDY-LIFECYCLE full test')
        // Token inspect must never return plaintext
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((inspectBody as any).token).toBeUndefined()

        // ── Revoke ──
        const revokeRes = await coreFetch(
          `/api/v0/identity/tokens/${issuedJti}/revoke`,
          securityAdminToken,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'E2E-IDY-LIFECYCLE manual revoke' })
          }
        )
        expect(revokeRes.status).toBe(200)
        const revokeBody = revokeRes.data as {
          token: { jti: string; status: string; revokeReason: string }
        }
        expect(revokeBody.token.jti).toBe(issuedJti)
        expect(revokeBody.token.status).toBe('revoked')
        expect(revokeBody.token.revokeReason).toBe('E2E-IDY-LIFECYCLE manual revoke')

        // ── Inspect after revoke ──
        const inspectAfterRes = await coreFetch(
          `/api/v0/identity/tokens/${issuedJti}`,
          securityAdminToken
        )
        expect(inspectAfterRes.status).toBe(200)
        const inspectAfterBody = inspectAfterRes.data as { status: string }
        expect(inspectAfterBody.status).toBe('revoked')

        // ── Use revoked token → 401 ──
        const useRevokedRes = await coreFetch('/api/v0/status', issuedToken)
        // FAILS RED: revoked token check not active without identity routes
        // Once wired: using a revoked token → 401
        expect(useRevokedRes.status).toBe(401)

        // ── operator cannot revoke tokens ──
        const operatorRevokeRes = await coreFetch(
          `/api/v0/identity/tokens/${issuedJti}/revoke`,
          operatorToken,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'E2E-IDY-LIFECYCLE operator attempt' })
          }
        )
        expect(operatorRevokeRes.status).toBe(403)
      })

      it('issue fails without required fields', async () => {
        // Missing actor
        const res = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({ ttl: '1h', purpose: 'missing actor' })
        })
        // FAILS RED: identity routes not mounted → 404
        // Once wired: validation fails → 400
        expect(res.status).toBe(400)

        // Missing purpose
        const res2 = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({ actor: 'operator', ttl: '1h' })
        })
        expect(res2.status).toBe(400)
      })

      it('token inspect returns 404 for non-existent jti', async () => {
        const res = await coreFetch(
          '/api/v0/identity/tokens/E2E-IDY-NONEXISTENT-jti',
          securityAdminToken
        )
        // FAILS RED: identity routes not mounted → 404 (same as not-found)
        // Once wired: non-existent jti → 404
        expect(res.status).toBe(404)
      })

      it('missing auth returns 401 for identity endpoints', async () => {
        const res = await coreFetch('/api/v0/identity/actors')
        // FAILS RED: identity routes not mounted → 404
        // Once wired: missing auth → 401
        expect(res.status).toBe(401)
      })
    })

    describe('secretRef v0.1', () => {
      let createdSecretId = ''
      const SENTINEL = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'

      it('security-admin creates a SecretRef', async () => {
        // FAILS RED: /api/v0/secrets route not mounted in Core app yet → 404
        const res = await coreFetch('/api/v0/secrets', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            name: `e2e-secret-${Date.now()}`,
            scope: 'service',
            value: 'e2e-test-secret-value-001'
          })
        })
        expect(res.status).toBe(201)
        const body = res.data as {
          id: string
          version: string
          name: string
          scope: string
          owner: string
          status: string
          createdBy: string
          createdAt: string
          metadata: Record<string, string>
        }
        expect(body.version).toBe('secret-ref@0.1.0')
        expect(body.scope).toBe('service')
        expect(body.owner).toBe('core')
        expect(body.status).toBe('active')
        expect(body.name).toStartWith('e2e-secret-')
        expect(typeof body.id).toBe('string')
        expect(typeof body.createdBy).toBe('string')
        expect(typeof body.createdAt).toBe('string')
        // Redaction: response must not contain the plaintext value.
        expect(JSON.stringify(body)).not.toContain('e2e-test-secret-value-001')
        expect(JSON.stringify(body)).not.toContain(SENTINEL)
        // No value/plaintext/secret fields in DTO response.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((body as any).value).toBeUndefined()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((body as any).plaintext).toBeUndefined()
        createdSecretId = body.id
      })

      it('security-admin lists secrets', async () => {
        // FAILS RED: /api/v0/secrets GET not mounted → 404
        const res = await coreFetch('/api/v0/secrets', securityAdminToken)
        expect(res.status).toBe(200)
        const body = res.data as { secrets: Array<{ id: string; name: string; status: string }> }
        expect(Array.isArray(body.secrets)).toBe(true)
        // No value fields in any listed secret.
        for (const entry of body.secrets) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((entry as any).value).toBeUndefined()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect((entry as any).plaintext).toBeUndefined()
        }
      })

      it('security-admin shows a single secret', async () => {
        // Need a secret ID from create (or use a known one).
        // If createdSecretId is empty, create one first.
        let secretId = createdSecretId
        if (!secretId) {
          const createRes = await coreFetch('/api/v0/secrets', securityAdminToken, {
            method: 'POST',
            body: JSON.stringify({
              name: `e2e-show-secret-${Date.now()}`,
              scope: 'system',
              value: 'e2e-show-value'
            })
          })
          expect(createRes.status).toBe(201)
          const createBody = createRes.data as { id: string }
          secretId = createBody.id
        }

        const res = await coreFetch(`/api/v0/secrets/${secretId}`, securityAdminToken)
        // FAILS RED: /api/v0/secrets/:id not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          id: string
          name: string
          scope: string
          status: string
          owner: string
          version: string
        }
        expect(body.id).toBe(secretId)
        expect(body.owner).toBe('core')
        expect(body.version).toBe('secret-ref@0.1.0')
        // No value leak in show response.
        const bodyStr = JSON.stringify(body)
        expect(bodyStr).not.toContain(SENTINEL)
        expect(bodyStr).not.toContain('"value"')
        expect(bodyStr).not.toContain('"plaintext"')
      })

      it('security-admin rotates a secret', async () => {
        let secretId = createdSecretId
        if (!secretId) {
          const createRes = await coreFetch('/api/v0/secrets', securityAdminToken, {
            method: 'POST',
            body: JSON.stringify({
              name: `e2e-rotate-secret-${Date.now()}`,
              scope: 'node',
              value: 'e2e-rotate-initial-value'
            })
          })
          expect(createRes.status).toBe(201)
          const createBody = createRes.data as { id: string }
          secretId = createBody.id
        }

        const res = await coreFetch(`/api/v0/secrets/${secretId}/rotate`, securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            value: 'e2e-rotated-new-value',
            reason: 'E2E-SECRET-REF rotation smoke test'
          })
        })
        // FAILS RED: /api/v0/secrets/:id/rotate not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          id: string
          status: string
          rotatedAt: string
          version: number
        }
        expect(body.status).toBe('rotated')
        expect(typeof body.rotatedAt).toBe('string')
        // No plaintext leak in rotate response.
        const bodyStr = JSON.stringify(body)
        expect(bodyStr).not.toContain('e2e-rotated-new-value')
        expect(bodyStr).not.toContain(SENTINEL)
        expect(bodyStr).not.toContain('"value"')
        expect(bodyStr).not.toContain('"plaintext"')
      })

      it('security-admin disables a secret', async () => {
        // Create a fresh secret to disable.
        const createRes = await coreFetch('/api/v0/secrets', securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            name: `e2e-disable-secret-${Date.now()}`,
            scope: 'service',
            value: 'e2e-disable-value'
          })
        })
        expect(createRes.status).toBe(201)
        const createBody = createRes.data as { id: string }
        const secretId = createBody.id

        const res = await coreFetch(`/api/v0/secrets/${secretId}/disable`, securityAdminToken, {
          method: 'POST',
          body: JSON.stringify({
            reason: 'E2E-SECRET-REF disable smoke test'
          })
        })
        // FAILS RED: /api/v0/secrets/:id/disable not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          id: string
          status: string
          disabledAt: string
        }
        expect(body.status).toBe('disabled')
        expect(typeof body.disabledAt).toBe('string')
      })

      it('operator cannot create secrets (403)', async () => {
        const res = await coreFetch('/api/v0/secrets', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            name: 'operator-secret-attempt',
            scope: 'service',
            value: 'should-not-create'
          })
        })
        // FAILS RED: /api/v0/secrets not mounted → 404
        // Once wired: operator lacks secret:create → 403
        expect(res.status).toBe(403)
      })

      it('viewer cannot list secrets (403)', async () => {
        const res = await coreFetch('/api/v0/secrets', viewerToken)
        // FAILS RED: /api/v0/secrets not mounted → 404
        expect(res.status).toBe(403)
      })

      it('operator cannot rotate secrets (403)', async () => {
        const res = await coreFetch('/api/v0/secrets/E2E-SECRET-FAKE/rotate', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            value: 'should-not-rotate',
            reason: 'operator rotate attempt'
          })
        })
        // FAILS RED: route not mounted → 404
        expect(res.status).toBe(403)
      })

      it('operator cannot disable secrets (403)', async () => {
        const res = await coreFetch('/api/v0/secrets/E2E-SECRET-FAKE/disable', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            reason: 'operator disable attempt'
          })
        })
        // FAILS RED: route not mounted → 404
        expect(res.status).toBe(403)
      })

      it('missing auth returns 401 for secret endpoints', async () => {
        const res = await coreFetch('/api/v0/secrets')
        // FAILS RED: route not mounted → 404
        // Once wired: missing auth → 401
        expect(res.status).toBe(401)
      })
    })
  })
}
            }
          })
        })
        expect(res.status).toBe(201)
        const body = res.data as {
          config: {
            id: string
            configVersion: string
            schemaVersion: string
            configHash: string
            domain: string
            targetScope: string[]
            status: string
            createdBy: string
            createdAt: string
          }
        }
        expect(body.config.status).toBe('draft')
        expect(body.config.domain).toBe('core')
        expect(body.config.targetScope).toContain('m-net')
        expect(typeof body.config.id).toBe('string')
        expect(typeof body.config.configHash).toBe('string')
        expect(body.config.configHash).toHaveLength(64) // sha256 hex
        draftedConfigId = body.config.id
      })

      it('lists configs including the drafted one', async () => {
        const res = await coreFetch('/api/v0/configs', operatorToken)
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as { configs: Array<{ id: string; status: string }> }
        expect(Array.isArray(body.configs)).toBe(true)
        if (draftedConfigId) {
          expect(body.configs.some((c) => c.id === draftedConfigId)).toBe(true)
        }
      })

      it('shows a single config by id', async () => {
        if (!draftedConfigId) return // skip if draft failed above
        const res = await coreFetch(
          `/api/v0/configs/${draftedConfigId}`,
          operatorToken
        )
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          config: { id: string; status: string; domain: string }
        }
        expect(body.config.id).toBe(draftedConfigId)
        expect(body.config.status).toBe('draft')
        expect(body.config.domain).toBe('core')
      })

      it('validates a drafted config', async () => {
        if (!draftedConfigId) return
        const res = await coreFetch(
          `/api/v0/configs/${draftedConfigId}/validate`,
          operatorToken,
          { method: 'POST' }
        )
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          config: { id: string; status: string; configHash: string }
        }
        expect(body.config.id).toBe(draftedConfigId)
        expect(body.config.status).toBe('validated')
      })

      it('publishes a validated config with reason', async () => {
        if (!draftedConfigId) return
        const res = await coreFetch(
          `/api/v0/configs/${draftedConfigId}/publish`,
          operatorToken,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'E2E-CFG-PUB opentelemetry rollout' })
          }
        )
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          config: {
            id: string
            status: string
            publishedBy: string
            publishedAt: string
          }
        }
        expect(body.config.status).toBe('published')
        expect(typeof body.config.publishedBy).toBe('string')
        expect(typeof body.config.publishedAt).toBe('string')
      })

      it('rolls back a published config to a previous version', async () => {
        if (!draftedConfigId) return
        const res = await coreFetch(
          `/api/v0/configs/${draftedConfigId}/rollback`,
          operatorToken,
          {
            method: 'POST',
            body: JSON.stringify({
              toVersion: '1.0.0',
              reason: 'E2E-CFG-ROLLBACK scheduled rollback'
            })
          }
        )
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(200)
        const body = res.data as {
          config: { id: string; status: string; rollbackVersion: string }
        }
        expect(body.config.status).toBe('rolled_back')
        expect(body.config.rollbackVersion).toBe('1.0.0')
      })

      it('viewer cannot draft config (lacks config:draft)', async () => {
        const res = await coreFetch('/api/v0/configs/drafts', viewerToken, {
          method: 'POST',
          body: JSON.stringify({
            domain: 'core',
            targetScope: [],
            payload: { key: 'value' }
          })
        })
        // FAILS RED: config routes not mounted → 404
        // Once wired: viewer lacks config:draft → 403
        expect(res.status).toBe(403)
      })

      it('viewer cannot publish config (lacks config:publish)', async () => {
        const res = await coreFetch(
          '/api/v0/configs/E2E-CFG-NOEXIST/publish',
          viewerToken,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'E2E-CFG viewer attempt' })
          }
        )
        // FAILS RED: config routes not mounted → 404
        expect(res.status).toBe(403)
      })

      it('viewer can list configs (has config:read)', async () => {
        const res = await coreFetch('/api/v0/configs', viewerToken)
        // FAILS RED: config routes not mounted → 404
        // Once wired: viewer has config:read → 200
        expect(res.status).toBe(200)
      })

      it('rejects draft with plaintext secret in payload', async () => {
        const res = await coreFetch('/api/v0/configs/drafts', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            domain: 'core',
            targetScope: ['m-net'],
            payload: {
              settings: {
                password: 'E2E-CFG-plaintext-pwd',
                apiKey: 'E2E-CFG-plaintext-key'
              }
            }
          })
        })
        // FAILS RED: config routes not mounted → 404
        // Once wired: plaintext secrets → 400
        expect(res.status).toBe(400)
        const body = res.data as { error: { code: string } }
        expect(body.error.code).toBe('config.secret_plaintext_rejected')
      })

      it('rejects publish without reason field', async () => {
        const res = await coreFetch(
          '/api/v0/configs/E2E-CFG-NOEXIST/publish',
          operatorToken,
          {
            method: 'POST',
            body: JSON.stringify({})
          }
        )
        // FAILS RED: config routes not mounted → 404
        // Once wired: missing reason → 400
        expect(res.status).toBe(400)
      })

      it('returns 404 for non-existent config id', async () => {
        const res = await coreFetch(
          '/api/v0/configs/E2E-CFG-NONEXISTENT',
          operatorToken
        )
        // FAILS RED: config routes not mounted → 404 (same as not-found)
        // Once wired: non-existent config → 404
        expect(res.status).toBe(404)
      })
    })
  })
})
    })
  })
}
