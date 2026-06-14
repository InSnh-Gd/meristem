/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  baseEnv,
  coreFetch,
  infrastructureAvailable,
  startFullStack,
  stopFullStack
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: identity v0.2', () => {
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

  describe('e2e: identity v0.2', () => {
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

    it('security-admin lists actors', async () => {
      const res = await coreFetch('/api/v0/identity/actors', securityAdminToken)
      expect(res.status).toBe(200)
      const body = res.data as {
        actors: Array<{ id: string; displayName: string; status: string }>
      }
      expect(Array.isArray(body.actors)).toBe(true)
      expect(body.actors.length).toBeGreaterThan(0)
      expect(body.actors.some(a => a.id === 'operator')).toBe(true)
    })

    it('operator cannot list actors (identity:read self only, not all)', async () => {
      const res = await coreFetch('/api/v0/identity/actors', operatorToken)
      expect(res.status).toBe(403)
    })

    it('security-admin issues a token for operator', async () => {
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
      expect(res.status).toBe(403)
    })

    // 完整的 token 生命周期测试：签发 → 查看 → 吊销 → 验证吊销后不可用
    it('security-admin issues → inspects → revokes token lifecycle', async () => {
      // ── 签发 ──
      const issueRes = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({
          actor: 'operator',
          ttl: '1h',
          purpose: 'E2E-IDY-LIFECYCLE full test'
        })
      })
      expect(issueRes.status).toBe(201)
      const issueBody = issueRes.data as { token: string; jti: string; status: string }

      expect(issueBody.status).toBe('active')
      const issuedJti = issueBody.jti
      const issuedToken = issueBody.token

      // ── 查看 token ──
      const inspectRes = await coreFetch(`/api/v0/identity/tokens/${issuedJti}`, securityAdminToken)
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
      expect(inspectBody).not.toHaveProperty('token')

      // ── 吊销 token ──
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

      // ── 吊销后查看 ──
      const inspectAfterRes = await coreFetch(
        `/api/v0/identity/tokens/${issuedJti}`,
        securityAdminToken
      )
      expect(inspectAfterRes.status).toBe(200)
      const inspectAfterBody = inspectAfterRes.data as { status: string }
      expect(inspectAfterBody.status).toBe('revoked')

      // ── 使用已吊销的 token → 401 ──
      const useRevokedRes = await coreFetch('/api/v0/status', issuedToken)
      expect(useRevokedRes.status).toBe(401)

      // ── operator 不能吊销 token ──
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
      // Missing purpose
      const res = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({ actor: 'operator', ttl: '1h' })
      })
      expect(res.status).toBe(400)

      // Empty purpose
      const res2 = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({ actor: 'operator', ttl: '1h', purpose: '' })
      })
      expect(res2.status).toBe(400)
    })

    it('token inspect returns 404 for non-existent jti', async () => {
      const res = await coreFetch(
        '/api/v0/identity/tokens/E2E-IDY-NONEXISTENT-jti',
        securityAdminToken
      )
      expect(res.status).toBe(404)
    })

    it('missing auth returns 401 for identity endpoints', async () => {
      const res = await coreFetch('/api/v0/identity/actors')
      expect(res.status).toBe(401)
    })

    // ── Internal introspection ──
    let introspectionJti = ''

    it('internal introspection resolves an active token', async () => {
      // Issue a token first
      const issueRes = await coreFetch('/api/v0/identity/tokens', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({
          actor: 'operator',
          ttl: '1h',
          purpose: 'E2E-IDY-INTROSPECTION test'
        })
      })
      expect(issueRes.status).toBe(201)
      const issueBody = issueRes.data as { jti: string; token: string }
      introspectionJti = issueBody.jti

      const res = await coreFetch('/internal/v0/identity/tokens/introspect', undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
        body: JSON.stringify({ jti: introspectionJti })
      })
      expect(res.status).toBe(200)
      const body = res.data as { jti: string; active: boolean; actor: string }
      expect(body.active).toBe(true)
      expect(body.actor).toBe('operator')
    })

    it('internal introspection resolves a revoked token as inactive', async () => {
      // Revoke the token
      const revokeRes = await coreFetch(
        `/api/v0/identity/tokens/${introspectionJti}/revoke`,
        securityAdminToken,
        { method: 'POST', body: JSON.stringify({ reason: 'E2E-IDY-INTROSPECTION revoke' }) }
      )
      expect(revokeRes.status).toBe(200)

      const res = await coreFetch('/internal/v0/identity/tokens/introspect', undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
        body: JSON.stringify({ jti: introspectionJti })
      })
      expect(res.status).toBe(200)
      const body = res.data as { jti: string; active: boolean }
      expect(body.active).toBe(false)
    })

    it('internal introspection returns inactive for non-existent jti', async () => {
      const res = await coreFetch('/internal/v0/identity/tokens/introspect', undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
        body: JSON.stringify({ jti: 'E2E-IDY-NONEXISTENT-introspection-jti' })
      })
      expect(res.status).toBe(200)
      const body = res.data as { jti: string; active: boolean }
      expect(body.active).toBe(false)
    })

    it('internal introspection rejects without internal token', async () => {
      const res = await coreFetch('/internal/v0/identity/tokens/introspect', undefined, {
        method: 'POST',
        body: JSON.stringify({ jti: introspectionJti })
      })
      expect(res.status).toBe(401)
    })

    it('internal introspection rejects with invalid internal token', async () => {
      const res = await coreFetch('/internal/v0/identity/tokens/introspect', undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': 'invalid-e2e-token' },
        body: JSON.stringify({ jti: introspectionJti })
      })
      expect(res.status).toBe(401)
    })
  })
}
