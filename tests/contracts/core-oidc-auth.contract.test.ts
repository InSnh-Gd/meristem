import { afterAll, describe, expect, it } from 'bun:test'
import {
  createOidcAuthProvider,
  mintLocalToken,
  oidcSupportedAlgorithms
} from '../../packages/auth/src/index.ts'
import {
  actorFromOidcSession,
  createOidcSessionAuthPort,
  oidcConfigFromEnv
} from '../../apps/core/src/adapters/auth.ts'
import type { OidcActorSession } from '../../packages/auth/src/index.ts'

/**
 * 生产身份认证端口契约：本地受管 token 优先，OIDC access token 兜底验证；
 * groups → actor 映射按权限从高到低先命中先得，未命中收敛到 viewer。
 */

const originalOtelExporter = process.env.MERISTEM_OTEL_EXPORTER

const fixedNow = new Date('2026-09-07T00:00:00.000Z')

function fakeOidcProvider() {
  let verifyResult:
    | { ok: true; session: OidcActorSession }
    | { ok: false; code: string; message: string } = {
    ok: false,
    code: 'invalid_token',
    message: 'no session configured'
  }
  const base = createOidcAuthProvider(
    {
      provider: 'oidc' as const,
      issuer: 'https://idp.example',
      audiences: ['meristem-core'],
      allowedAlgorithms: [...oidcSupportedAlgorithms]
    },
    { now: () => fixedNow }
  )
  // Object.assign 覆盖 verifyAccessToken，保留 provider 其余方法形状
  const provider = Object.assign(base, {
    verifyAccessToken: async (input: { token: string }) => {
      if (input.token === 'fail-provider') {
        return { ok: false as const, code: 'stale_jwks', message: 'JWKS unavailable' }
      }
      return verifyResult
    }
  })
  return {
    provider,
    setSession(session: OidcActorSession) {
      verifyResult = { ok: true, session }
    },
    setFailure(code: string, message: string) {
      verifyResult = { ok: false, code, message }
    }
  }
}

function createPort() {
  const fake = fakeOidcProvider()
  const localSecret = 'oidc-port-test-secret'
  // 本地受管 token 校验需要查询吊销状态；空结果即视为未吊销
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => []
        })
      })
    })
  } as unknown as Parameters<typeof createOidcSessionAuthPort>[0]
  const port = createOidcSessionAuthPort(db, {
    localSecret,
    oidcConfig: {
      provider: 'oidc' as const,
      issuer: 'https://idp.example',
      audiences: ['meristem-core'],
      allowedAlgorithms: [...oidcSupportedAlgorithms]
    },
    oidcProvider: fake.provider
  })
  return { fake, port, localSecret }
}

afterAll(() => {
  if (originalOtelExporter === undefined) delete process.env.MERISTEM_OTEL_EXPORTER
  else process.env.MERISTEM_OTEL_EXPORTER = originalOtelExporter
})

describe('OIDC session auth port', () => {
  it('verifies a locally minted managed token without touching OIDC', async () => {
    const { fake, port, localSecret } = createPort()
    const token = await mintLocalToken({ actor: 'admin', secret: localSecret })
    const result = await port.verify(token)
    expect(result.ok).toBe(true)
    if (result.ok && 'actor' in result) {
      expect((result as { actor: string }).actor).toBe('admin')
    }
    // 本地路径成功时不允许 fallback 触发
    fake.setFailure('stale_jwks', 'should not be called')
  })

  it('falls back to OIDC verification and maps groups to the highest-privilege actor', async () => {
    const { fake, port } = createPort()
    fake.setSession({
      subject: 'user-1',
      groups: ['admins', 'admin'],
      issuer: 'https://idp.example',
      expiresAt: '2026-09-07T01:00:00.000Z'
    })
    const result = await port.verify('oidc-access-token')
    expect(result.ok).toBe(true)
    if (result.ok && 'actor' in result) {
      expect((result as { actor: string }).actor).toBe('admin')
    }
  })

  it('maps unknown groups to the viewer actor', async () => {
    const { fake, port } = createPort()
    fake.setSession({
      subject: 'user-2',
      groups: ['everyone'],
      issuer: 'https://idp.example',
      expiresAt: '2026-09-07T01:00:00.000Z'
    })
    const result = await port.verify('oidc-access-token')
    expect(result.ok).toBe(true)
    if (result.ok && 'actor' in result) {
      expect((result as { actor: string }).actor).toBe('viewer')
    }
  })

  it('propagates OIDC failures as typed auth errors instead of passing through', async () => {
    const { fake, port } = createPort()
    fake.setFailure('stale_jwks', 'JWKS unavailable')
    const result = await port.verify('broken-token')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect((result as { code: string }).code).toBe('stale_jwks')
    }
  })
})

describe('OIDC group to actor mapping', () => {
  it('prefers security-admin over lower privilege groups', () => {
    expect(
      actorFromOidcSession({
        subject: 's',
        groups: ['operator', 'security-admin', 'viewer'],
        issuer: 'i',
        expiresAt: 'e'
      })
    ).toBe('security-admin')
  })

  it('falls back to viewer when no known group matches', () => {
    expect(
      actorFromOidcSession({
        subject: 's',
        groups: ['unknown'],
        issuer: 'i',
        expiresAt: 'e'
      })
    ).toBe('viewer')
  })
})

describe('OIDC env config assembly', () => {
  it('returns null when OIDC env is not configured', () => {
    const previous = process.env.MERISTEM_OIDC_ISSUER
    delete process.env.MERISTEM_OIDC_ISSUER
    try {
      expect(oidcConfigFromEnv()).toBeNull()
    } finally {
      if (previous !== undefined) process.env.MERISTEM_OIDC_ISSUER = previous
    }
  })

  it('builds a provider config from env and drops unsupported algorithms', () => {
    const env = {
      MERISTEM_OIDC_ISSUER: 'https://idp.example',
      MERISTEM_OIDC_AUDIENCES: 'meristem-core, other',
      MERISTEM_OIDC_ALLOWED_ALGORITHMS: 'RS256, HS256, ES256'
    }
    const config = oidcConfigFromEnv(env)
    expect(config).not.toBeNull()
    expect(config?.provider).toBe('oidc')
    expect(config?.audiences).toEqual(['meristem-core', 'other'])
    expect(config?.allowedAlgorithms).toEqual(['RS256', 'ES256'])
  })
})
