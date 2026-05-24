import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

describe('GET /api/v0/session', () => {
  it('returns actor and permissions for a valid operator token', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))
    const res = await app.handle(
      new Request('http://localhost/api/v0/session', {
        headers: { authorization: 'Bearer test-token' }
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { actor: string; permissions: string[] }
    expect(body.actor).toBe('operator')
    expect(Array.isArray(body.permissions)).toBe(true)
    expect(body.permissions).toContain('core:read')
    expect(body.permissions).toContain('task:submit')
  })

  it('returns viewer permissions correctly', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' }))
    const res = await app.handle(
      new Request('http://localhost/api/v0/session', {
        headers: { authorization: 'Bearer test-token' }
      })
    )
    const body = await res.json() as { actor: string; permissions: string[] }
    expect(body.actor).toBe('viewer')
    expect(body.permissions).toContain('core:read')
    expect(body.permissions).not.toContain('task:submit')
  })

  it('returns 401 when no token is provided', async () => {
    const app = createCoreApp(createInMemoryCoreDeps())
    const res = await app.handle(new Request('http://localhost/api/v0/session'))
    expect(res.status).toBe(401)
  })
})

