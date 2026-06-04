import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

// 失败模式门禁：OpenSearch 不可用不能阻塞权威日志写入。
describe('OpenSearch failure modes', () => {
  it('returns 503 on timeline search when search is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator', searchAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline/search?q=test', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(503)
  })

  it('returns 503 on full log search when search is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator', searchAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/logs/full/search?q=error', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(503)
  })

  it('returns 503 on audit search when search is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin', searchAvailable: false })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/audit/search?q=test', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(503)
  })

  it('returns 403 when viewer attempts full log search', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const fullRes = await app.handle(
      new Request('http://localhost/api/v0/logs/full/search?q=test', {
        headers: { authorization: 'Bearer viewer-token' }
      })
    )
    expect(fullRes.status).toBe(403)
  })

  it('returns 403 when viewer attempts audit search', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const auditRes = await app.handle(
      new Request('http://localhost/api/v0/audit/search?q=test', {
        headers: { authorization: 'Bearer viewer-token' }
      })
    )
    expect(auditRes.status).toBe(403)
  })

  it('log writes still succeed when search is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin', searchAvailable: false })
    const app = createCoreApp(deps)

    const timelineList = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(timelineList.status).toBe(200)

    const fullList = await app.handle(
      new Request('http://localhost/api/v0/logs/full', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(fullList.status).toBe(200)

    const auditList = await app.handle(
      new Request('http://localhost/api/v0/audit', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(auditList.status).toBe(200)
  })

  it('search is available and returns empty results by default', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline/search?q=anything', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { entries: unknown[]; total: number }
    expect(body.entries).toEqual([])
    expect(body.total).toBe(0)
  })
})

