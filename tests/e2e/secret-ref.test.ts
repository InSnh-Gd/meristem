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
  describe('e2e: secretRef v0.1', () => {
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

  describe('e2e: secretRef v0.1', () => {
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

    let createdSecretId = ''
    const SENTINEL = 'super_secret_sentinel_12345'

    it('security-admin creates a SecretRef with redacted plaintext', async () => {
      const res = await coreFetch('/api/v0/secrets', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({
          name: `e2e-secret-${Date.now()}`,
          scope: 'service',
          value: SENTINEL
        })
      })
      expect(res.status).toBe(201)
      const body = res.data as { id: string; name: string; status: string; createdAt: string }
      expect(body.name).toStartWith('e2e-secret-')
      expect(body.status).toBe('active')
      expect(typeof body.id).toBe('string')
      expect(typeof body.createdAt).toBe('string')
      expect(JSON.stringify(body)).not.toContain(SENTINEL)
      expect(JSON.stringify(body)).not.toContain('"value"')
      expect(JSON.stringify(body)).not.toContain('"plaintext"')
      createdSecretId = body.id
    })

    it('security-admin lists and shows SecretRef metadata only', async () => {
      const listRes = await coreFetch('/api/v0/secrets', securityAdminToken)
      expect(listRes.status).toBe(200)
      const listBody = listRes.data as Array<{ id: string; name: string; status: string }>
      expect(Array.isArray(listBody)).toBe(true)
      expect(JSON.stringify(listBody)).not.toContain(SENTINEL)
      expect(JSON.stringify(listBody)).not.toContain('"value"')
      expect(JSON.stringify(listBody)).not.toContain('"plaintext"')

      const secretId = createdSecretId || listBody[0]?.id
      expect(typeof secretId).toBe('string')
      if (!secretId) throw new Error('missing secret id for metadata lookup test')

      const showRes = await coreFetch(`/api/v0/secrets/${secretId}`, securityAdminToken)
      expect(showRes.status).toBe(200)
      const showBody = showRes.data as {
        id: string
        name: string
        status: string
        updatedAt: string
      }
      expect(showBody.id).toBe(secretId)
      expect(JSON.stringify(showBody)).not.toContain(SENTINEL)
      expect(JSON.stringify(showBody)).not.toContain('"value"')
      expect(JSON.stringify(showBody)).not.toContain('"plaintext"')
    })

    it('security-admin rotates and disables SecretRefs without plaintext output', async () => {
      const rotateRes = await coreFetch(
        `/api/v0/secrets/${createdSecretId}/rotate`,
        securityAdminToken,
        {
          method: 'POST',
          body: JSON.stringify({ value: SENTINEL, reason: 'E2E-SECRET-REF rotation smoke test' })
        }
      )
      expect(rotateRes.status).toBe(200)
      const rotateBody = rotateRes.data as {
        id: string
        status: string
        rotatedAt: string
        version: string
      }
      expect(rotateBody.id).toBe(createdSecretId)
      expect(rotateBody.status).toBe('rotated')
      expect(typeof rotateBody.rotatedAt).toBe('string')
      expect(JSON.stringify(rotateBody)).not.toContain(SENTINEL)

      const createRes = await coreFetch('/api/v0/secrets', securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({
          name: `e2e-disable-secret-${Date.now()}`,
          scope: 'service',
          value: SENTINEL
        })
      })
      expect(createRes.status).toBe(201)
      const createBody = createRes.data as { id: string }
      const disableRes = await coreFetch(
        `/api/v0/secrets/${createBody.id}/disable`,
        securityAdminToken,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'E2E-SECRET-REF disable smoke test' })
        }
      )
      expect(disableRes.status).toBe(200)
      const disableBody = disableRes.data as { id: string; status: string; disabledAt: string }
      expect(disableBody.id).toBe(createBody.id)
      expect(disableBody.status).toBe('disabled')
      expect(typeof disableBody.disabledAt).toBe('string')
    })

    it('rejects insufficient or missing SecretRef permissions', async () => {
      const operatorCreate = await coreFetch('/api/v0/secrets', operatorToken, {
        method: 'POST',
        body: JSON.stringify({
          name: 'operator-secret-attempt',
          scope: 'service',
          value: 'should-not-create'
        })
      })
      expect(operatorCreate.status).toBe(403)
      expect((await coreFetch('/api/v0/secrets', viewerToken)).status).toBe(403)
      expect((await coreFetch('/api/v0/secrets')).status).toBe(401)
    })

    // ── 内部 secretRef reference 路由 ──
    it('internal secret reference returns 404 for non-existent secret', async () => {
      const res = await coreFetch(
        '/internal/v0/secrets/E2E-NONEXISTENT-reference-secret/reference',
        undefined,
        {
          method: 'POST',
          headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN }
        }
      )
      expect(res.status).toBe(404)
    })

    it('internal secret reference rejects without internal token', async () => {
      const res = await coreFetch(`/internal/v0/secrets/${createdSecretId}/reference`, undefined, {
        method: 'POST'
      })
      expect(res.status).toBe(401)
    })

    // ── 内部 secret disable 路由（不支持，返回 404） ──
    it('internal secret disable route is not available (404)', async () => {
      const res = await coreFetch(`/internal/v0/secrets/${createdSecretId}/disable`, undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN }
      })
      expect(res.status).toBe(404)
    })

    it('internal secret disable rejects without internal token (401)', async () => {
      const res = await coreFetch(`/internal/v0/secrets/${createdSecretId}/disable`, undefined, {
        method: 'POST'
      })
      expect(res.status).toBe(401)
    })
  })
}
