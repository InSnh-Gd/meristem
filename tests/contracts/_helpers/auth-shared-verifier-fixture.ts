import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose'
import type { AuthProviderRuntimeConfigFromSchema } from '../../../packages/contracts/src/index.ts'

export const keycloakIssuer = 'https://keycloak.control-plane.example.com/realms/meristem'
export const keycloakAudience = 'meristem-core'
export const localJwtSecret = 'shared-verifier-local-secret'

const discoveryUrl = `${keycloakIssuer}/.well-known/openid-configuration`
const jwksUri = `${keycloakIssuer}/protocol/openid-connect/certs`

export type KeycloakVerifierFixture = {
  readonly authConfig: AuthProviderRuntimeConfigFromSchema
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  readonly signKeycloakToken: (overrides?: KeycloakTokenOverrides) => Promise<string>
  readonly signWithUntrustedKey: (overrides?: KeycloakTokenOverrides) => Promise<string>
  readonly discoveryCalls: () => number
  readonly jwksCalls: () => number
}

export type KeycloakTokenOverrides = {
  readonly issuer?: string
  readonly audience?: string
  readonly subject?: string
  readonly preferredUsername?: string
  readonly email?: string
  readonly realmRoles?: readonly string[]
  readonly clientRoles?: readonly string[]
  readonly expiresAtSeconds?: number
  readonly issuedAtSeconds?: number
  readonly omitRealmAccess?: boolean
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

async function keyPairWithJwk(kid: string): Promise<{
  readonly privateKey: CryptoKey
  readonly publicJwk: JWK
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const exported = await exportJWK(publicKey)
  return {
    privateKey,
    publicJwk: {
      ...exported,
      kid,
      alg: 'RS256',
      use: 'sig'
    }
  }
}

function buildClaims(overrides: KeycloakTokenOverrides): JWTPayload {
  return {
    preferred_username: overrides.preferredUsername ?? 'Meristem Operator',
    email: overrides.email ?? 'operator@example.com',
    ...(overrides.omitRealmAccess
      ? {}
      : {
          realm_access: {
            roles: overrides.realmRoles ?? ['operator', 'network:read', 'task:submit']
          }
        }),
    resource_access: {
      'meristem-core': {
        roles: overrides.clientRoles ?? ['audit:read']
      }
    }
  }
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  overrides: KeycloakTokenOverrides = {}
): Promise<string> {
  const nowSeconds = overrides.issuedAtSeconds ?? Math.floor(Date.now() / 1_000)
  return new SignJWT(buildClaims(overrides))
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(overrides.issuer ?? keycloakIssuer)
    .setAudience(overrides.audience ?? keycloakAudience)
    .setSubject(overrides.subject ?? 'operator')
    .setIssuedAt(nowSeconds)
    .setExpirationTime(overrides.expiresAtSeconds ?? nowSeconds + 300)
    .setJti(`keycloak-token-${crypto.randomUUID()}`)
    .sign(privateKey)
}

export async function createKeycloakVerifierFixture(): Promise<KeycloakVerifierFixture> {
  const trusted = await keyPairWithJwk('trusted-keycloak-key')
  const untrusted = await keyPairWithJwk('untrusted-keycloak-key')
  let discoveryCallCount = 0
  let jwksCallCount = 0

  const authConfig: AuthProviderRuntimeConfigFromSchema = {
    provider: 'oidc',
    issuer: keycloakIssuer,
    audiences: [keycloakAudience],
    discoveryUrl,
    allowedAlgorithms: ['RS256'],
    claims: {
      subjectClaim: 'sub',
      groupsClaim: 'realm_access.roles'
    },
    jwksCache: {
      refreshIntervalMs: 10_000,
      ttlMs: 60_000
    },
    clockToleranceSeconds: 0
  }

  return {
    authConfig,
    async fetch(input) {
      const url = requestUrl(input)
      if (url === discoveryUrl) {
        discoveryCallCount += 1
        return jsonResponse({
          issuer: keycloakIssuer,
          authorization_endpoint: `${keycloakIssuer}/protocol/openid-connect/auth`,
          token_endpoint: `${keycloakIssuer}/protocol/openid-connect/token`,
          jwks_uri: jwksUri
        })
      }
      if (url === jwksUri) {
        jwksCallCount += 1
        return jsonResponse({ keys: [trusted.publicJwk] })
      }
      return jsonResponse({ error: 'not_found' }, 404)
    },
    signKeycloakToken: overrides => signToken(trusted.privateKey, 'trusted-keycloak-key', overrides),
    signWithUntrustedKey: overrides =>
      signToken(untrusted.privateKey, 'untrusted-keycloak-key', overrides),
    discoveryCalls: () => discoveryCallCount,
    jwksCalls: () => jwksCallCount
  }
}

export function unavailableKeycloakFetch(): (input: string | URL | Request) => Promise<Response> {
  return async () => {
    throw new Error('Keycloak unavailable')
  }
}
