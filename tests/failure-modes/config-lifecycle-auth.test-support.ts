import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  bearerHeaders,
  draftConfig,
  publishConfig,
  rollbackConfig,
  validDraftPayload
} from '../helpers/config-lifecycle.ts'

export function registerConfigLifecycleAuthTests(): void {
  it('returns 403 when viewer attempts config draft', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await draftConfig(app, 'viewer')

    expect(response.status).toBe(403)
  })

  it('returns 403 when operator attempts config publish', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    // operator has config:read + config:validate but NOT config:publish
    const response = await publishConfig(app, 'CFG-FM-AUTHZ-cfg-001', 'operator')

    expect(response.status).toBe(403)
  })

  it('returns 403 when operator attempts config rollback', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-AUTHZ-cfg-002', '0.1.0', 'operator')

    expect(response.status).toBe(403)
  })

  it('returns 401 for config list without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(new Request('http://localhost/api/v0/configs'))

    expect(response.status).toBe(401)
  })

  it('returns 401 for config draft without auth header', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validDraftPayload())
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 401 for internal apply-ack without x-meristem-internal-token', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/internal/v0/configs/CFG-FM-ACK-no-internal/apply-ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ackedBy: 'm-net', status: 'acked' })
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 400 when draft payload contains plaintext secret keys', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const badPayload = {
      domain: 'core',
      targetScope: ['m-net'],
      payload: {
        settings: {
          apiKey: 'sk-plaintext-bad',
          password: 'pwd123'
        }
      }
    }

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs/drafts', {
        method: 'POST',
        headers: bearerHeaders('admin'),
        body: JSON.stringify(badPayload)
      })
    )

    // Draft payload validation must reject inline plaintext secret material.
    expect(response.status).toBe(400)

    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('config.secret_plaintext_rejected')
    expect(body.error.message).toContain('plaintext')
  })
}
