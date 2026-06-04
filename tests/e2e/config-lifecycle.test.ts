/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  infrastructureAvailable,
  startFullStack,
  stopFullStack,
  coreFetch,
  baseEnv
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: config lifecycle v0.1', () => {
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

  describe('e2e: config lifecycle v0.1', () => {
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

    let draftedConfigId = ''
    let draftedConfigVersion = ''

    it('drafts, lists, and shows a config', async () => {
      const res = await coreFetch('/api/v0/configs/drafts', operatorToken, {
        method: 'POST',
        body: JSON.stringify({
          domain: 'core',
          targetScope: ['m-net'],
          payload: { telemetry: { endpointSecretRef: 'secret-ref:e2e' } }
        })
      })
      expect(res.status).toBe(201)
      const body = res.data as { config: { id: string; configVersion: string; status: string; createdAt: string } }
      expect(body.config.status).toBe('draft')
      expect(typeof body.config.id).toBe('string')
      draftedConfigId = body.config.id
      draftedConfigVersion = body.config.configVersion

      const listRes = await coreFetch('/api/v0/configs', operatorToken)
      expect(listRes.status).toBe(200)
      const listBody = listRes.data as { configs: Array<{ id: string; status: string }> }
      expect(listBody.configs.some((config) => config.id === draftedConfigId)).toBe(true)

      const showRes = await coreFetch(`/api/v0/configs/${draftedConfigId}`, operatorToken)
      expect(showRes.status).toBe(200)
      const showBody = showRes.data as { config: { id: string; status: string; domain: string; targetScope: string[]; configHash: string } }
      expect(showBody.config.id).toBe(draftedConfigId)
      expect(showBody.config.status).toBe('draft')
      expect(showBody.config.domain).toBe('core')
      expect(showBody.config.targetScope).toContain('m-net')
      expect(showBody.config.configHash).toHaveLength(64)
    })

    it('validates, publishes, acks, and rolls back a config', async () => {
      const validateRes = await coreFetch(`/api/v0/configs/${draftedConfigId}/validate`, operatorToken, { method: 'POST' })
      expect(validateRes.status).toBe(200)
      expect((validateRes.data as { config: { status: string } }).config.status).toBe('validated')

      const publishRes = await coreFetch(`/api/v0/configs/${draftedConfigId}/publish`, securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({ reason: 'E2E-CFG-PUB opentelemetry rollout' })
      })
      expect(publishRes.status).toBe(200)
      expect((publishRes.data as { config: { status: string; publishedBy: string; publishedAt: string } }).config.status).toBe('published')

      const ackRes = await coreFetch(`/internal/v0/configs/${draftedConfigId}/apply-ack`, undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
        body: JSON.stringify({ configVersion: draftedConfigVersion, targetService: 'm-net', status: 'acked' })
      })
      expect(ackRes.status).toBe(200)
      expect((ackRes.data as { ack: { status: string; configId: string } }).ack.configId).toBe(draftedConfigId)

      const rollbackRes = await coreFetch(`/api/v0/configs/${draftedConfigId}/rollback`, securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({ toVersion: draftedConfigVersion, reason: 'E2E-CFG-ROLLBACK scheduled rollback' })
      })
      expect(rollbackRes.status).toBe(200)
      expect((rollbackRes.data as { config: { status: string } }).config.status).toBe('rolled_back')
    })

    // 未 validate 直接 publish → 409 invalid_state
    it('publishing a draft without validate returns 409 invalid_state', async () => {
      // 创建一个新的 draft
      const draftRes = await coreFetch('/api/v0/configs/drafts', operatorToken, {
        method: 'POST',
        body: JSON.stringify({ domain: 'm-ui', targetScope: ['m-ui'], payload: { theme: 'light' } })
      })
      expect(draftRes.status).toBe(201)
      const draftBody = draftRes.data as { config: { id: string; configVersion: string } }
      const unpublishableId = draftBody.config.id

      // 未 validate 直接 publish → 409 invalid_state
      const publishRes = await coreFetch(`/api/v0/configs/${unpublishableId}/publish`, securityAdminToken, {
        method: 'POST',
        body: JSON.stringify({ reason: 'E2E-CFG-PUB skip validate' })
      })
      expect(publishRes.status).toBe(409)
      const publishBody = publishRes.data as { error: { code: string } }
      expect(publishBody.error.code).toBe('config.invalid_state')
    })

    it('enforces config auth and plaintext secret boundaries', async () => {
      const viewerDraft = await coreFetch('/api/v0/configs/drafts', viewerToken, {
        method: 'POST',
        body: JSON.stringify({ domain: 'core', targetScope: [], payload: { key: 'value' } })
      })
      expect(viewerDraft.status).toBe(403)
      expect((await coreFetch('/api/v0/configs', viewerToken)).status).toBe(200)

      const plaintextDraft = await coreFetch('/api/v0/configs/drafts', operatorToken, {
        method: 'POST',
        body: JSON.stringify({ domain: 'core', targetScope: ['m-net'], payload: { settings: { password: 'E2E-CFG-plaintext-pwd' } } })
      })
      expect(plaintextDraft.status).toBe(400)
      expect((plaintextDraft.data as { error: { code: string } }).error.code).toBe('config.secret_plaintext_rejected')
    })
  })
}
