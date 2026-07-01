import { describe, expect, test } from 'bun:test'
import {
  createSharedAuthVerifier,
  mintLocalToken
} from '../../packages/auth/src/index.ts'
import {
  createKeycloakVerifierFixture,
  keycloakAudience,
  keycloakIssuer,
  localJwtSecret
} from './_helpers/auth-shared-verifier-fixture.ts'

describe('shared configurable auth verifier contract', () => {
  test('verifies a Keycloak token through the shared OIDC boundary', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({
      auth: fixture.authConfig,
      oidc: { fetch: fixture.fetch }
    })
    const token = await fixture.signKeycloakToken()

    const result = await verifier.verify(token)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session).toMatchObject({
      provider: 'oidc',
      actor: {
        id: 'operator',
        displayName: 'Meristem Operator',
        email: 'operator@example.com'
      },
      issuer: keycloakIssuer,
      audience: keycloakAudience,
      groups: ['operator', 'network:read', 'task:submit'],
      permissions: ['network:read', 'task:submit']
    })
    expect(fixture.discoveryCalls()).toBe(1)
    expect(fixture.jwksCalls()).toBe(1)
  })

  test('verifies a local JWT only when local-dev provider is selected', async () => {
    const verifier = createSharedAuthVerifier({
      auth: { provider: 'local-dev' },
      localDev: { jwtSecret: localJwtSecret }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: localJwtSecret })

    const result = await verifier.verify(token)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session).toMatchObject({
      provider: 'local-dev',
      actor: { id: 'admin', displayName: 'admin' },
      issuer: 'meristem-local',
      audience: 'meristem-core',
      groups: [],
      permissions: []
    })
  })

  test('rejects local JWT mechanically when OIDC provider is selected', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({
      auth: fixture.authConfig,
      oidc: { fetch: fixture.fetch },
      localDev: { jwtSecret: localJwtSecret }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: localJwtSecret })

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unsupported_algorithm')
  })

  test('rejects OIDC token when local-dev provider is selected', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({
      auth: { provider: 'local-dev' },
      localDev: { jwtSecret: localJwtSecret }
    })
    const token = await fixture.signKeycloakToken()

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_token')
  })

  test('returns a consistent failure for invalid issuer', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const token = await fixture.signKeycloakToken({ issuer: 'https://issuer.example.invalid' })

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('bad_issuer')
  })

  test('returns a consistent failure for invalid audience', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const token = await fixture.signKeycloakToken({ audience: 'other-service' })

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('bad_audience')
  })

  test('returns a consistent failure for invalid signature', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const token = await fixture.signWithUntrustedKey()

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_token')
  })

  test('returns a consistent failure for expired token', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const nowSeconds = Math.floor(Date.now() / 1_000)
    const token = await fixture.signKeycloakToken({
      issuedAtSeconds: nowSeconds - 600,
      expiresAtSeconds: nowSeconds - 300
    })

    const result = await verifier.verify(token)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('expired_token')
  })
})
