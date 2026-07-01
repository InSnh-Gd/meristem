import { describe, expect, test } from 'bun:test'
import {
  createSharedAuthVerifier,
  mintLocalToken
} from '../../packages/auth/src/index.ts'
import {
  createKeycloakVerifierFixture,
  localJwtSecret,
  unavailableKeycloakFetch
} from '../contracts/_helpers/auth-shared-verifier-fixture.ts'

describe('shared auth verifier failure modes', () => {
  test('fails readiness when Keycloak discovery is unavailable without local JWT fallback', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({
      auth: fixture.authConfig,
      oidc: { fetch: unavailableKeycloakFetch() },
      localDev: { jwtSecret: localJwtSecret }
    })

    const readiness = await verifier.checkReadiness()

    expect(readiness.ok).toBe(false)
    if (readiness.ok) return
    expect(readiness.code).toBe('invalid_discovery')
  })

  test('accepts Keycloak token and rejects local JWT in OIDC mode', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({
      auth: fixture.authConfig,
      oidc: { fetch: fixture.fetch },
      localDev: { jwtSecret: localJwtSecret }
    })
    const keycloakToken = await fixture.signKeycloakToken()
    const localToken = await mintLocalToken({ actor: 'admin', secret: localJwtSecret })

    await expect(verifier.verify(keycloakToken)).resolves.toMatchObject({ ok: true })
    const localResult = await verifier.verify(localToken)

    expect(localResult.ok).toBe(false)
    if (localResult.ok) return
    expect(localResult.code).toBe('unsupported_algorithm')
  })

  test('rejects expired OIDC tokens', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const nowSeconds = Math.floor(Date.now() / 1_000)
    const token = await fixture.signKeycloakToken({
      issuedAtSeconds: nowSeconds - 600,
      expiresAtSeconds: nowSeconds - 300
    })

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      code: 'expired_token'
    })
  })

  test('rejects OIDC tokens with an invalid signature', async () => {
    const fixture = await createKeycloakVerifierFixture()
    const verifier = createSharedAuthVerifier({ auth: fixture.authConfig, oidc: { fetch: fixture.fetch } })
    const token = await fixture.signWithUntrustedKey()

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_token'
    })
  })
})
