import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createLocalJWKSet, type JSONWebKeySet } from 'jose'
import type { OidcAuthProviderConfigFromSchema } from '../../contracts/src/index.ts'
import {
  cacheAgeMs,
  type CachedJwks,
  type OidcDiscoveryDocument,
  type OidcDiscoveryFailure,
  type OidcDiscoveryResult,
  type OidcProviderDependencies,
  type OidcStaleJwksFailure,
  type OidcVerifyResult,
  oidcSupportedAlgorithms,
  type VerifyOidcAccessTokenInput,
  isOidcFailure,
  isSupportedAlgorithm,
  mapVerifiedPayloadToSession,
  normalizeProviderConfig,
  readProtectedAlgorithm,
  redactOidcAuthMaterial,
  validateDiscoveryDocument,
  verifyJwtWithJwks
} from './oidc-provider-support.ts'

const OidcDiscoveryDocumentSchema = Type.Object(
  {
    issuer: Type.String(),
    authorization_endpoint: Type.String(),
    token_endpoint: Type.String(),
    jwks_uri: Type.String()
  },
  { additionalProperties: true }
)

const JwksResponseSchema = Type.Object(
  {
    keys: Type.Array(
      Type.Object(
        {
          kty: Type.String(),
          kid: Type.Optional(Type.String()),
          use: Type.Optional(Type.String()),
          alg: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    )
  },
  { additionalProperties: true }
)

type OidcDiscoveryDocumentPayload = Static<typeof OidcDiscoveryDocumentSchema>
type JwksResponse = Static<typeof JwksResponseSchema>

function decodeOidcDiscoveryDocument(payload: unknown): OidcDiscoveryDocumentPayload | OidcDiscoveryFailure {
  try {
    return Value.Cast(OidcDiscoveryDocumentSchema, payload)
  } catch {
    return {
      ok: false,
      code: 'invalid_discovery',
      message:
        'OIDC discovery document must include issuer, authorization_endpoint, token_endpoint, and jwks_uri'
    }
  }
}

function decodeJwksResponse(payload: unknown): JwksResponse {
  try {
    return Value.Cast(JwksResponseSchema, payload)
  } catch {
    throw new Error('OIDC JWKS payload must contain a keys array')
  }
}

/**
 * OIDC provider 负责 discovery、JWKS stale-while-revalidate cache 和 access token verify。
 */
export function createOidcAuthProvider(
  input: OidcAuthProviderConfigFromSchema,
  dependencies: OidcProviderDependencies = {}
) {
  const config = normalizeProviderConfig(input)
  const fetchImpl = dependencies.fetch ?? fetch
  const now = dependencies.now ?? (() => new Date())

  let cachedDiscovery: OidcDiscoveryDocument | null = null
  let discoveryPromise: Promise<OidcDiscoveryResult> | null = null
  let cachedJwks: CachedJwks | null = null
  let refreshPromise: Promise<CachedJwks> | null = null

  async function discoverConfiguration(): Promise<OidcDiscoveryResult> {
    if (cachedDiscovery) {
      return { ok: true, configuration: cachedDiscovery }
    }

    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        const response = await fetchImpl(config.discoveryUrl)
        const payload = await response.json()
        const decoded = decodeOidcDiscoveryDocument(payload)
        if ('ok' in decoded) {
          return decoded
        }
        const validated = validateDiscoveryDocument(config.issuer, decoded)
        if (validated.ok) {
          cachedDiscovery = validated.configuration
        }
        return validated
      })().finally(() => {
        discoveryPromise = null
      })
    }

    return discoveryPromise
  }

  async function refreshJwks(): Promise<CachedJwks> {
    if (cachedDiscovery === null) {
      throw new Error('OIDC discovery must complete before JWKS refresh')
    }

    const response = await fetchImpl(cachedDiscovery.jwksUri)
    const payload = decodeJwksResponse(await response.json())
    const jwks: JSONWebKeySet = { keys: payload.keys }
    const fetchedAtMs = now().getTime()
    return {
      jwks,
      keySet: createLocalJWKSet(jwks),
      fetchedAtMs,
      refreshAfterMs: fetchedAtMs + config.jwksRefreshIntervalMs,
      expiresAtMs: fetchedAtMs + config.jwksTtlMs
    }
  }

  function startBackgroundRefresh(): void {
    if (refreshPromise) {
      return
    }

    refreshPromise = refreshJwks()
      .then(nextCache => {
        cachedJwks = nextCache
        return nextCache
      })
      .finally(() => {
        refreshPromise = null
      })

    void refreshPromise.catch(() => undefined)
  }

  /**
   * cache 进入 refresh window 时继续提供旧 key，并在后台刷新；超过 hard TTL 后刷新失败则 fail closed。
   */
  async function ensureUsableJwks(): Promise<CachedJwks | OidcStaleJwksFailure | OidcDiscoveryFailure> {
    const nowMs = now().getTime()

    if (!cachedJwks) {
      const discovery = await discoverConfiguration()
      if (!discovery.ok) {
        return discovery
      }

      try {
        cachedJwks = await refreshJwks()
        return cachedJwks
      } catch (error) {
        return {
          ok: false,
          code: 'stale_jwks',
          message: error instanceof Error ? error.message : 'OIDC JWKS fetch failed'
        }
      }
    }

    if (nowMs < cachedJwks.refreshAfterMs) {
      return cachedJwks
    }

    if (nowMs < cachedJwks.expiresAtMs) {
      startBackgroundRefresh()
      return cachedJwks
    }

    try {
      cachedJwks = refreshPromise ? await refreshPromise : await refreshJwks()
      return cachedJwks
    } catch {
      const ageMs = cacheAgeMs(cachedJwks, nowMs)
      return {
        ok: false,
        code: 'stale_jwks',
        message: 'OIDC JWKS cache is stale and refresh failed',
        ...(ageMs === undefined ? {} : { cacheAgeMs: ageMs })
      }
    }
  }

  async function verifyAccessToken(input: VerifyOidcAccessTokenInput): Promise<OidcVerifyResult> {
    const algorithm = readProtectedAlgorithm(input.token)
    if (algorithm === null) {
      return { ok: false, code: 'invalid_token', message: 'OIDC access token is malformed' }
    }

    if (!isSupportedAlgorithm(algorithm) || !config.allowedAlgorithms.includes(algorithm)) {
      return {
        ok: false,
        code: 'unsupported_algorithm',
        algorithm,
        message: 'OIDC access token algorithm is not allowed'
      }
    }

    const jwks = await ensureUsableJwks()
    if (isOidcFailure(jwks)) {
      return jwks
    }

    const verified = await verifyJwtWithJwks({
      token: input.token,
      jwks,
      config,
      nowMs: now().getTime()
    })
    if (isOidcFailure(verified)) {
      return verified
    }

    const mapped = mapVerifiedPayloadToSession(verified.payload, config.claims)
    if (isOidcFailure(mapped)) {
      return mapped
    }

    if (input.checkTokenState) {
      const tokenState = await input.checkTokenState(mapped)
      if (tokenState === 'revoked') {
        return {
          ok: false,
          code: 'revoked_token',
          message: 'OIDC access token was revoked by upstream identity control'
        }
      }
      if (tokenState === 'introspection_required') {
        return {
          ok: false,
          code: 'introspection_required',
          message: 'OIDC access token requires upstream introspection before use'
        }
      }
    }

    return { ok: true, session: mapped }
  }

  return {
    discoverConfiguration,
    verifyAccessToken,
    redactOidcAuthMaterial,
    getCachedJwks() {
      return cachedJwks
    }
  }
}

export { oidcSupportedAlgorithms, redactOidcAuthMaterial }
export type {
  OidcActorSession,
  OidcAuthFailure,
  OidcDiscoveryDocument,
  OidcDiscoveryResult,
  OidcProviderDependencies,
  OidcRedactedLogContext,
  OidcSupportedAlgorithm,
  OidcTokenState,
  VerifyOidcAccessTokenInput
} from './oidc-provider-support.ts'

export type OidcAuthConfig = OidcAuthProviderConfigFromSchema
export type OidcAuthProvider = ReturnType<typeof createOidcAuthProvider>
export type OidcAuthProviderDeps = OidcProviderDependencies
