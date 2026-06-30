import { beforeEach, describe, expect, it } from 'bun:test'
import {
  MNetProfileDetailResponseSchema,
  MNetProfileListResponseSchema
} from '../../packages/contracts/src/index.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import {
  bearerHeaders,
  createTestApp,
  decodeJson,
  ErrorResponseSchema,
  internalToken,
  jwtSecret,
  mintTestToken
} from './_helpers/mnet-profile-routes.ts'

describe('M-Net profile external routes', () => {
  const buildApp = () =>
    createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('GET /api/v0/network-profiles returns registered v0.3 profiles with valid JWT', async () => {
    const app = buildApp()
    const token = await mintTestToken('operator')

    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles', {
        headers: bearerHeaders(token)
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, MNetProfileListResponseSchema)
    expect(body.profiles).toHaveLength(2)
    const versions = body.profiles
      .map((p: (typeof body.profiles)[number]) => p.profileVersion)
      .sort()
    expect(versions).toEqual([
      'm-net-cn@0.3.0',
      'm-net@0.3.0'
    ])
  })

  it('GET /api/v0/network-profiles returns 401 without bearer token', async () => {
    const app = buildApp()
    const response = await app.handle(new Request('http://localhost/api/v0/network-profiles'))

    expect(response.status).toBe(401)
  })

  it('GET /api/v0/network-profiles/m-net-cn@0.3.0 returns CN profile', async () => {
    const app = buildApp()
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/m-net-cn@0.3.0', {
        headers: bearerHeaders(actorToken)
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, MNetProfileDetailResponseSchema)
    expect(body.profileVersion).toBe('m-net-cn@0.3.0')
    expect(body.region).toBe('cn')
    expect(body.displayName).toContain('v0.3')
    expect(body.capabilities.controlPlaneOnly).toBe(false)
  })

  it('GET /api/v0/network-profiles/m-net@0.3.0 returns default profile', async () => {
    const app = buildApp()
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/m-net@0.3.0', {
        headers: bearerHeaders(actorToken)
      })
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, MNetProfileDetailResponseSchema)
    expect(body.profileVersion).toBe('m-net@0.3.0')
    expect(body.region).toBe('default')
  })

  it('GET /api/v0/network-profiles/unknown returns 404', async () => {
    const app = buildApp()
    const actorToken = await mintTestToken('admin')
    const response = await app.handle(
      new Request('http://localhost/api/v0/network-profiles/unknown-profile@0.1.0', {
        headers: bearerHeaders(actorToken)
      })
    )

    expect(response.status).toBe(404)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('profile.not_found')
  })
})
