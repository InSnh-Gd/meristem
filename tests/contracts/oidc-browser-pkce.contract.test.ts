import { describe, expect, test } from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { createOidcAuthorizationCodeClient } from '../../packages/auth/src/index.ts'

const issuer = 'https://keycloak.example.test/realms/meristem'
const authorizationEndpoint = `${issuer}/protocol/openid-connect/auth`
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`
const jwksUri = `${issuer}/protocol/openid-connect/certs`

async function createSignedIdToken(input: {
  privateKey: CryptoKey
  nonce: string
  subject?: string
}) {
  const now = Math.floor(Date.now() / 1_000)
  return new SignJWT({
    nonce: input.nonce,
    preferred_username: 'operator',
    email: 'operator@example.test',
    groups: ['security-admin']
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'oidc-browser-test-key' })
    .setIssuer(issuer)
    .setAudience('meristem-m-ui-bff')
    .setSubject(input.subject ?? 'stable-subject')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(input.privateKey)
}

describe('OIDC authorization-code PKCE client', () => {
  test('binds the ID token nonce to the OIDC login transaction and keeps only local IAM claims', async () => {
    const keys = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(keys.publicKey)
    const jwk: JWK = { ...publicJwk, kid: 'oidc-browser-test-key', alg: 'RS256', use: 'sig' }
    let token = await createSignedIdToken({ privateKey: keys.privateKey, nonce: 'expected-nonce' })
    let codeExchangeBody = ''

    const client = createOidcAuthorizationCodeClient({
      provider: {
        contractVersion: 'oidc-iam-provider@0.1.0',
        provider: 'keycloak-oidc',
        issuer,
        clientId: 'meristem-m-ui-bff',
        redirectUri: 'https://bff.example.test/api/v0/auth/oidc/callback',
        scopes: ['openid', 'profile', 'email'],
        responseType: 'code',
        pkceRequired: true,
        stateRequired: true,
        nonceRequired: true,
        claimAuthority: 'authentication-only',
        localIamAuthority: true
      },
      async fetch(input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url === `${issuer}/.well-known/openid-configuration`) {
          return Response.json({
            issuer,
            authorization_endpoint: authorizationEndpoint,
            token_endpoint: tokenEndpoint,
            jwks_uri: jwksUri
          })
        }
        if (url === jwksUri) return Response.json({ keys: [jwk] })
        if (url === tokenEndpoint) {
          codeExchangeBody = String(init?.body ?? '')
          return Response.json({ id_token: token, access_token: 'must-not-leave-bff' })
        }
        return new Response('not found', { status: 404 })
      }
    })

    const authorization = await client.createAuthorizationUrl({
      state: 'state-value',
      nonce: 'expected-nonce',
      codeChallenge: 'challenge-value'
    })
    expect(authorization.ok).toBe(true)
    if (!authorization.ok) throw new Error(authorization.error.message)
    const url = new URL(authorization.value.authorizationUrl)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('nonce')).toBe('expected-nonce')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const accepted = await client.exchangeAuthorizationCode({
      code: 'authorization-code',
      codeVerifier: 'verifier-value',
      nonce: 'expected-nonce'
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error(accepted.error.message)
    expect(accepted.value).toEqual({
      oidcIssuer: issuer,
      oidcSubject: 'stable-subject',
      display: { email: 'operator@example.test', name: 'operator' }
    })
    expect(codeExchangeBody).toContain('grant_type=authorization_code')
    expect(codeExchangeBody).toContain('code_verifier=verifier-value')
    expect(JSON.stringify(accepted.value)).not.toContain('access_token')

    token = await createSignedIdToken({ privateKey: keys.privateKey, nonce: 'different-nonce' })
    const rejected = await client.exchangeAuthorizationCode({
      code: 'authorization-code',
      codeVerifier: 'verifier-value',
      nonce: 'expected-nonce'
    })
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('Expected nonce mismatch to be rejected')
    expect(rejected.error.code).toBe('invalid_token')
  })
})
